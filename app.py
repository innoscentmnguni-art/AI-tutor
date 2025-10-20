from flask import Flask, render_template, request, jsonify, send_file
import base64
import cv2
import numpy as np
from gaze_tracking import ScreenEngagementDetector
import azure.cognitiveservices.speech as speechsdk
import google.generativeai as genai
import os
import tempfile
import uuid
from dotenv import load_dotenv
from PIL import Image
import matplotlib.pyplot as plt
import io

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Initialize gaze detector
gaze_detector = ScreenEngagementDetector()
@app.route('/gaze', methods=['POST'])
def gaze():
    data = request.json
    frame_data = data.get('frame')
    calibrate = data.get('calibrate', False)
    if not frame_data:
        return jsonify({'error': 'No frame provided'}), 400

    # Decode base64 image
    try:
        img_bytes = base64.b64decode(frame_data)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    except Exception as e:
        return jsonify({'error': 'Failed to decode image', 'details': str(e)}), 400

    # Calibrate if requested
    if calibrate:
        h, w = frame.shape[:2]
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = gaze_detector.face_mesh.process(frame_rgb)
        if results.multi_face_landmarks:
            face_landmarks = results.multi_face_landmarks[0].landmark
            head_center, R_final, nose_points_3d = gaze_detector.compute_head_pose(face_landmarks, w, h)
            gaze_detector.calibrate(face_landmarks, head_center, R_final, nose_points_3d, w, h)

    # Process frame
    processed_frame, engaged, gaze_angle = gaze_detector.process_frame(frame)

    # Encode processed frame to base64
    _, buffer = cv2.imencode('.jpg', processed_frame)
    processed_b64 = base64.b64encode(buffer).decode('utf-8')

    return jsonify({
        'processed_frame': processed_b64,
        'engaged': engaged,
        'gaze_angle': gaze_angle
    })

# Configure API keys
SPEECH_KEY = os.getenv("SPEECH_KEY")
SPEECH_REGION = os.getenv("SPEECH_REGION")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Configure Gemini
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.5-flash')

# System prompt for the tutor persona — concise, friendly, and student-focused.
# The model should keep answers short, conversational, and aim to teach clearly.
SYSTEM_PROMPT = (
    "You are an AI tutor. Structure your responses with two distinct parts:\n"
    "1. BOARD: Start with text between BOARD[...] markers for what to show on the board\n"
    "2. SPEAK: Follow with what you want to say, explaining concepts\n\n"
    "Example for an equation:\n"
    "BOARD[Straight Line Equation:\n\n y = mx + c]\n"
    "SPEAK: I've written the equation of a straight line on the board. This is the general form where m represents the slope "
    "and c is where the line crosses the y-axis.\n\n"
    "Example for steps:\n"
    "BOARD[Steps to Solve:\n\n 1. First, identify the variables\n 2. Then, substitute the values\n 3. Finally, solve the equation]\n"
    "SPEAK: Let me guide you through these steps one by one...\n\n"
    "Guidelines:\n"
    "- Put board text between BOARD[...]\n"
    "- Use line breaks (\n) to separate lines on the board\n"
    "- Keep each line short and clear\n"
    "- Start equations on a new line\n"
    "- After SPEAK:, explain concepts naturally\n"
    "- Keep explanations concise and student-friendly"
)

# Tutor name and persona rules (Nova)
SYSTEM_PROMPT += (
    "\n\nAdditional persona rules:\n"
    "- Your name is Nova. If the user says 'Nova', they are referring to you.\n"
    "- Do NOT volunteer the origin of the name Nova (e.g., supernova/explosion metaphors) unless the user explicitly asks about it.\n"
    "- If the user asks about the origin, answer briefly and then move on; do not repeatedly reference explosions or supernovas.\n"
    "- Do not use supernova/explosion metaphors to describe the learning process unless the user brings them up; if they do, acknowledge and move on quickly.\n"
)

def text_to_speech(text):
    speech_config = speechsdk.SpeechConfig(subscription=SPEECH_KEY, region=SPEECH_REGION)
    speech_config.speech_synthesis_voice_name = "en-ZA-LukeNeural"
    filename = os.path.join(tempfile.gettempdir(), f"speech_{uuid.uuid4()}.wav")
    audio_config = speechsdk.audio.AudioOutputConfig(filename=filename)
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=audio_config)

    visemes = []
    def viseme_callback(evt):
        visemes.append({
            "offset": evt.audio_offset / 10000,  # ms
            "viseme_id": evt.viseme_id
        })

    synthesizer.viseme_received.connect(viseme_callback)
    result = synthesizer.speak_text_async(text).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        return filename, visemes
    else:
        print(f"Error synthesizing audio: {result.reason}")
        return None, None


# Serve home page at root
@app.route('/')
def home():
    return render_template('home.html')

# Main app page (previously at '/')
@app.route('/learn')
def learn():
    return render_template('index.html')

def generate_response(prompt):
    try:
        # Prepend system prompt to guide model behavior. Gemini client expects text content,
        # so send a single concatenated string rather than a custom dict.
        combined_prompt = SYSTEM_PROMPT + "\n\nUser: " + str(prompt)
        response = model.generate_content(combined_prompt)
        if response and hasattr(response, 'text'):
            return response.text
        else:
            print("No valid response received from the model")
            return None
    except Exception as e:
        print(f"Error generating response: {str(e)}")
        if hasattr(e, 'status_code'):
            print(f"Status code: {e.status_code}")
        return None


def render_latex_to_file(latex):
    # Renders LaTeX string to a PNG file and returns the file path
    try:
        fig = plt.figure(figsize=(12, 4))  # Wider figure for equations
        fig.text(0.5, 0.5, f"${latex}$", fontsize=36, horizontalalignment='center', verticalalignment='center')
        buf = io.BytesIO()
        fig.patch.set_alpha(0)
        plt.axis('off')
        fig.savefig(buf, format='png', dpi=300, bbox_inches='tight', pad_inches=0.2, transparent=True)
        plt.close(fig)
        buf.seek(0)
        filename = os.path.join(tempfile.gettempdir(), f"latex_{uuid.uuid4()}.png")
        with open(filename, 'wb') as f:
            f.write(buf.read())
        return filename
    except Exception as e:
        print('Failed to render LaTeX:', e)
        return None

@app.route('/synthesize', methods=['POST'])
def synthesize():
    data = request.json
    user_input = data.get('text', '')

    if not user_input:
        return jsonify({'error': 'No text provided'}), 400

    # Generate AI response
    ai_response = generate_response(user_input)
    if not ai_response:
        return jsonify({'error': 'Failed to generate AI response'}), 500

    # Extract board text and spoken text
    import re
    board_match = re.search(r"BOARD\[(.*?)\]", ai_response, flags=re.DOTALL)
    board_text = board_match.group(1).strip() if board_match else ""
    
    # Extract the spoken part (after "SPEAK:")
    speak_match = re.search(r"SPEAK:\s*(.+)$", ai_response, flags=re.DOTALL)
    spoken_text = speak_match.group(1).strip() if speak_match else ai_response

    # Convert spoken text to speech
    audio_file, visemes = text_to_speech(spoken_text)
    if audio_file:
        resp = {
            'success': True,
            'audio_url': f'/audio/{os.path.basename(audio_file)}',
            'visemes': visemes,
            'board_text': board_text  # Send the board text to display
        }
        return jsonify(resp)
    else:
        return jsonify({'error': 'Failed to synthesize speech'}), 500


@app.route('/greeting')
def greeting():
    # Predefined greeting that the avatar will lip-sync on start
    greet_spoken = "Hello. My name is Nova, your digital AI tutor. What would you like to learn today?"
    board_text = "Welcome\nMy name is Nova\nwhat would you like to learn today"
    audio_file, visemes = text_to_speech(greet_spoken)
    if audio_file:
        return jsonify({
            'success': True,
            'audio_url': f'/audio/{os.path.basename(audio_file)}',
            'visemes': visemes,
            'board_text': board_text
        })
    else:
        return jsonify({'success': False}), 500


@app.route('/render_latex', methods=['POST'])
def render_latex():
    data = request.json or {}
    latex = data.get('latex', '')
    if not latex:
        return jsonify({'error': 'No LaTeX provided'}), 400

    # Render LaTeX to PNG using matplotlib
    try:
        fig = plt.figure()
        fig.text(0, 0.9, f"${latex}$", fontsize=20)
        buf = io.BytesIO()
        fig.patch.set_alpha(0)
        plt.axis('off')
        fig.savefig(buf, format='png', dpi=200, bbox_inches='tight', pad_inches=0.1, transparent=True)
        plt.close(fig)
        buf.seek(0)
        filename = os.path.join(tempfile.gettempdir(), f"latex_{uuid.uuid4()}.png")
        with open(filename, 'wb') as f:
            f.write(buf.read())
        return jsonify({'url': f'/latex/{os.path.basename(filename)}'})
    except Exception as e:
        print('Failed to render LaTeX:', e)
        return jsonify({'error': 'Render failed'}), 500


@app.route('/latex/<filename>')
def serve_latex(filename):
    return send_file(os.path.join(tempfile.gettempdir(), filename))

@app.route('/audio/<filename>')
def serve_audio(filename):
    return send_file(os.path.join(tempfile.gettempdir(), filename))

@app.route('/transcribe', methods=['POST'])
def transcribe():
    # Accept uploaded WAV file and transcribe using Azure Speech SDK
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    f = request.files['file']
    if f.filename == '':
        return jsonify({'error': 'Empty filename'}), 400

    tmp_filename = os.path.join(tempfile.gettempdir(), f"stt_{uuid.uuid4()}.wav")
    try:
        # Save uploaded file
        f.save(tmp_filename)

        # Configure Azure Speech SDK (using same key/region as TTS)
        speech_config = speechsdk.SpeechConfig(subscription=SPEECH_KEY, region=SPEECH_REGION)
        # Use same language as TTS voice (en-ZA)
        speech_config.speech_recognition_language = 'en-ZA'

        audio_input = speechsdk.audio.AudioConfig(filename=tmp_filename)
        recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config, audio_config=audio_input)

        # Recognize once is good for short uploads (1-2 sentences). For longer audio,
        # we could use continuous recognition with event handlers.
        result = recognizer.recognize_once_async().get()

        transcript_text = ''
        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            transcript_text = result.text
        else:
            print("Transcription failed:", result.reason)
            if result.reason == speechsdk.ResultReason.Canceled:
                details = speechsdk.CancellationDetails(result)
                print("Cancellation reason:", details.reason)
                print("Error details:", details.error_details)

        return jsonify({'transcript': transcript_text})
    except Exception as e:
        print("Transcription error:", e)
        return jsonify({'error': 'Transcription failed', 'details': str(e)}), 500
    finally:
        try:
            if os.path.exists(tmp_filename):
                os.remove(tmp_filename)
        except Exception:
            pass

if __name__ == '__main__':
    app.run(debug=True)