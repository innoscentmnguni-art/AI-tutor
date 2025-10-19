import cv2
import numpy as np
import mediapipe as mp
import time
from collections import deque
from scipy.spatial.transform import Rotation as Rscipy
from enum import Enum, auto

class GazeState(Enum):
    ENGAGED = auto()
    DISENGAGED = auto()
    TRANSITIONING = auto()

class ScreenEngagementDetector:
    def __init__(self):
        self._init_mediapipe()
        self._init_calibration_vars()
        self._init_gaze_tracking_vars()
        self._init_engagement_vars()
        self.base_radius = 20

    def _init_mediapipe(self):
        """Initialize MediaPipe face mesh."""
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.nose_indices = [4, 45, 275, 220, 440, 1, 5, 51, 281, 44, 274, 241, 
                            461, 125, 354, 218, 438, 195, 167, 393, 165, 391, 3, 248]
    
    def _init_calibration_vars(self):
        """Initialize calibration-related variables."""
        self.left_sphere_locked = False
        self.right_sphere_locked = False
        self.left_sphere_local_offset = None
        self.right_sphere_local_offset = None
        self.left_calibration_nose_scale = None
        self.right_calibration_nose_scale = None
        self.R_ref_nose = [None]
    
    def _init_gaze_tracking_vars(self):
        """Initialize gaze tracking variables."""
        self.gaze_history = deque(maxlen=10)
        self.ENGAGEMENT_ANGLE_THRESHOLD = 5.0
        
    def _init_engagement_vars(self):
        """Initialize engagement tracking variables."""
        self.ENGAGEMENT_TIME_THRESHOLD = 1.0    # Time to consider user engaged
        self.DISENGAGEMENT_TIME_THRESHOLD = 0.5 # Faster to detect looking away
        self.state = GazeState.DISENGAGED
        self.state_change_time = None

    def compute_scale(self, points_3d):
        n = len(points_3d)
        total = 0
        count = 0
        for i in range(n):
            for j in range(i + 1, n):
                dist = np.linalg.norm(points_3d[i] - points_3d[j])
                total += dist
                count += 1
        return total / count if count > 0 else 1.0

    def compute_head_pose(self, face_landmarks, w, h):
        points_3d = np.array([
            [face_landmarks[i].x * w, face_landmarks[i].y * h, face_landmarks[i].z * w]
            for i in self.nose_indices
        ])
        center = np.mean(points_3d, axis=0)
        centered = points_3d - center
        cov = np.cov(centered.T)
        eigvals, eigvecs = np.linalg.eigh(cov)
        eigvecs = eigvecs[:, np.argsort(-eigvals)]
        if np.linalg.det(eigvecs) < 0:
            eigvecs[:, 2] *= -1
        r = Rscipy.from_matrix(eigvecs)
        roll, pitch, yaw = r.as_euler('zyx', degrees=False)
        R_final = Rscipy.from_euler('zyx', [roll, pitch, yaw]).as_matrix()
        if self.R_ref_nose[0] is None:
            self.R_ref_nose[0] = R_final.copy()
        else:
            R_ref = self.R_ref_nose[0]
            for i in range(3):
                if np.dot(R_final[:, i], R_ref[:, i]) < 0:
                    R_final[:, i] *= -1
        return center, R_final, points_3d

    def calibrate(self, face_landmarks, head_center, R_final, nose_points_3d, w, h):
        current_nose_scale = self.compute_scale(nose_points_3d)
        left_iris = face_landmarks[468]
        right_iris = face_landmarks[473]
        iris_3d_left = np.array([left_iris.x * w, left_iris.y * h, left_iris.z * w])
        iris_3d_right = np.array([right_iris.x * w, right_iris.y * h, right_iris.z * w])
        self.left_sphere_local_offset = R_final.T @ (iris_3d_left - head_center)
        camera_dir_world = np.array([0, 0, 1])
        camera_dir_local = R_final.T @ camera_dir_world
        self.left_sphere_local_offset += self.base_radius * camera_dir_local
        self.left_calibration_nose_scale = current_nose_scale
        self.left_sphere_locked = True
        self.right_sphere_local_offset = R_final.T @ (iris_3d_right - head_center)
        self.right_sphere_local_offset += self.base_radius * camera_dir_local
        self.right_calibration_nose_scale = current_nose_scale
        self.right_sphere_locked = True
        print("[Calibrated] Look at screen center and press 'c' again if accuracy is poor")
        return True

    def calculate_gaze_angle(self, gaze_direction):
        screen_normal = np.array([0, 0, -1])
        gaze_norm = gaze_direction / np.linalg.norm(gaze_direction)
        cos_angle = np.dot(gaze_norm, screen_normal)
        angle_rad = np.arccos(np.clip(cos_angle, -1.0, 1.0))
        angle_deg = np.degrees(angle_rad)
        return angle_deg

    def _should_change_state(self, current_time, is_engaging):
        """Check if enough time has passed to change state.
        
        Args:
            current_time: Current timestamp
            is_engaging: True if checking engagement time, False if checking disengagement
        """
        if self.state_change_time is None:
            return False
            
        threshold = (self.ENGAGEMENT_TIME_THRESHOLD if is_engaging 
                    else self.DISENGAGEMENT_TIME_THRESHOLD)
        return current_time - self.state_change_time >= threshold

    def _handle_looking_at_screen(self, current_time):
        """Handle state transitions when user is looking at screen."""
        if self.state == GazeState.DISENGAGED:
            if self.state_change_time is None:
                self.state_change_time = current_time
            elif self._should_change_state(current_time, is_engaging=True):
                self.state = GazeState.ENGAGED
                self.state_change_time = None
                print("[ENGAGED] User is actively looking at screen")
        elif self.state == GazeState.TRANSITIONING:
            self.state = GazeState.ENGAGED
            self.state_change_time = None

    def _handle_looking_away(self, current_time):
        """Handle state transitions when user is looking away."""
        if self.state == GazeState.ENGAGED:
            if self.state_change_time is None:
                self.state_change_time = current_time
            elif self._should_change_state(current_time, is_engaging=False):
                self.state = GazeState.DISENGAGED
                self.state_change_time = None
                print("[DISENGAGED] User looked away from screen")
        elif self.state == GazeState.TRANSITIONING:
            self.state = GazeState.DISENGAGED
            self.state_change_time = None

    def update_engagement(self, is_looking_at_screen):
        """Update engagement state based on gaze direction."""
        current_time = time.time()
        
        if is_looking_at_screen:
            self._handle_looking_at_screen(current_time)
        else:
            self._handle_looking_away(current_time)
            
        return self.state == GazeState.ENGAGED

    def _draw_landmarks(self, frame, face_landmarks, w, h):
        """Draw facial landmarks on frame."""
        for lm in face_landmarks:
            x, y = int(lm.x * w), int(lm.y * h)
            cv2.circle(frame, (x, y), 1, (100, 100, 100), -1)

    def _process_iris_positions(self, face_landmarks, w, h):
        """Extract iris positions in 3D space."""
        left_iris = face_landmarks[468]
        right_iris = face_landmarks[473]
        iris_3d_left = np.array([left_iris.x * w, left_iris.y * h, left_iris.z * w])
        iris_3d_right = np.array([right_iris.x * w, right_iris.y * h, right_iris.z * w])
        return iris_3d_left, iris_3d_right

    def _compute_gaze_direction(self, sphere_world_l, sphere_world_r, iris_3d_left, iris_3d_right):
        """Compute and normalize gaze direction vectors."""
        left_gaze_dir = iris_3d_left - sphere_world_l
        left_gaze_dir /= np.linalg.norm(left_gaze_dir)
        right_gaze_dir = iris_3d_right - sphere_world_r
        right_gaze_dir /= np.linalg.norm(right_gaze_dir)
        
        combined_gaze = (left_gaze_dir + right_gaze_dir) / 2
        combined_gaze /= np.linalg.norm(combined_gaze)
        
        self.gaze_history.append(combined_gaze)
        smoothed_gaze = np.mean(self.gaze_history, axis=0)
        smoothed_gaze /= np.linalg.norm(smoothed_gaze)
        
        return smoothed_gaze, left_gaze_dir, right_gaze_dir

    def _draw_gaze_visualization(self, frame, sphere_world_l, sphere_world_r, 
                               smoothed_gaze, left_gaze_dir, right_gaze_dir, 
                               is_looking_at_screen):
        """Draw gaze visualization lines and indicators on frame."""
        gaze_origin = (sphere_world_l + sphere_world_r) / 2
        gaze_end = gaze_origin + smoothed_gaze * 200
        color = (0, 255, 0) if is_looking_at_screen else (0, 0, 255)
        
        # Draw main gaze line
        cv2.line(frame, 
                (int(gaze_origin[0]), int(gaze_origin[1])),
                (int(gaze_end[0]), int(gaze_end[1])),
                color, 3)
        
        # Draw individual eye gaze lines
        left_end = sphere_world_l + left_gaze_dir * 150
        right_end = sphere_world_r + right_gaze_dir * 150
        cv2.line(frame, (int(sphere_world_l[0]), int(sphere_world_l[1])),
                (int(left_end[0]), int(left_end[1])), (200, 200, 0), 2)
        cv2.line(frame, (int(sphere_world_r[0]), int(sphere_world_r[1])),
                (int(right_end[0]), int(right_end[1])), (0, 200, 200), 2)

    def _draw_calibration_spheres(self, frame, sphere_world_l, sphere_world_r, 
                                scaled_radius_l, scaled_radius_r):
        """Draw eye calibration spheres on frame."""
        cv2.circle(frame, (int(sphere_world_l[0]), int(sphere_world_l[1])), 
                  scaled_radius_l, (255, 255, 0), 2)
        cv2.circle(frame, (int(sphere_world_r[0]), int(sphere_world_r[1])), 
                  scaled_radius_r, (0, 255, 255), 2)

    def _draw_uncalibrated_state(self, frame, iris_3d_left, iris_3d_right):
        """Draw indicators for uncalibrated state."""
        cv2.circle(frame, (int(iris_3d_left[0]), int(iris_3d_left[1])), 8, (255, 0, 0), 2)
        cv2.circle(frame, (int(iris_3d_right[0]), int(iris_3d_right[1])), 8, (0, 255, 0), 2)
        cv2.putText(frame, "Press 'C' to calibrate - Look at screen center", 
                (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

    def process_frame(self, frame):
        """Process a video frame and return gaze tracking results."""
        h, w = frame.shape[:2]
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(frame_rgb)
        is_looking_at_screen = False
        gaze_angle = None

        if not results.multi_face_landmarks:
            return frame, self.update_engagement(is_looking_at_screen), gaze_angle

        face_landmarks = results.multi_face_landmarks[0].landmark
        head_center, R_final, nose_points_3d = self.compute_head_pose(face_landmarks, w, h)
        iris_3d_left, iris_3d_right = self._process_iris_positions(face_landmarks, w, h)
        
        self._draw_landmarks(frame, face_landmarks, w, h)

        if not (self.left_sphere_locked and self.right_sphere_locked):
            self._draw_uncalibrated_state(frame, iris_3d_left, iris_3d_right)
            return frame, self.update_engagement(is_looking_at_screen), gaze_angle

        # Compute scaling and sphere positions
        current_nose_scale = self.compute_scale(nose_points_3d)
        scale_ratio_l = current_nose_scale / self.left_calibration_nose_scale
        scale_ratio_r = current_nose_scale / self.right_calibration_nose_scale
        
        sphere_world_l = head_center + R_final @ (self.left_sphere_local_offset * scale_ratio_l)
        sphere_world_r = head_center + R_final @ (self.right_sphere_local_offset * scale_ratio_r)
        
        scaled_radius_l = int(self.base_radius * scale_ratio_l)
        scaled_radius_r = int(self.base_radius * scale_ratio_r)
        
        self._draw_calibration_spheres(frame, sphere_world_l, sphere_world_r, 
                                     scaled_radius_l, scaled_radius_r)
        
        # Compute and visualize gaze
        smoothed_gaze, left_gaze_dir, right_gaze_dir = self._compute_gaze_direction(
            sphere_world_l, sphere_world_r, iris_3d_left, iris_3d_right)
        
        gaze_angle = self.calculate_gaze_angle(smoothed_gaze)
        is_looking_at_screen = gaze_angle < self.ENGAGEMENT_ANGLE_THRESHOLD
        
        self._draw_gaze_visualization(frame, sphere_world_l, sphere_world_r,
                                    smoothed_gaze, left_gaze_dir, right_gaze_dir,
                                    is_looking_at_screen)

        engaged = self.update_engagement(is_looking_at_screen)
        return frame, engaged, gaze_angle
