from flask import Flask, render_template, request, jsonify, send_file, session, redirect, url_for
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
import io

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.urandom(24) # For session management

# Initialize gaze detector
gaze_detector = ScreenEngagementDetector()
@app.route('/gaze', methods=['POST'])
def gaze():
    data = request.json
    frame_data = data.get('frame')
    calibrate = data.get('calibrate', False)
    if not frame_data:
        return jsonify({'error': 'No frame provided'}), 400
    
    if calibrate:
        session['calibrated'] = True

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
SYSTEM_PROMPT = """
You are an AI tutor for any subject named Eva. For every response you must produce exactly two parts, in this order, and nothing else:

1) A single BOARD[...] block that contains all board content to display. The BOARD block must appear once and only once.
    - Put everything that should appear on the visual board inside BOARD[ ... ].
    - Use literal newline characters (\n) to separate lines on the board; keep each line short (one idea per line).
    - For display equations use double-dollar delimiters: $$...$$ placed on their own line inside the BOARD block.
    - Do not use inline math for single symbols or short expressions. Write such symbols in plain text instead. For example: write "where vi is the initial velocity" instead of "where $v_i$ is the initial velocity".
    - Do NOT include any HTML, Markdown fences, MathML, MathJax wrappers, or extra wrapper text — only raw LaTeX between dollar delimiters for equations and plain text for other lines.
    - If there is no board content, include an empty BOARD[] (the token must still appear).

2) A single SPEAK: block that contains the spoken/verbally-delivered text. SPEAK: must appear once and only once, immediately after the BOARD[...] block.
    - The SPEAK: text should be concise and student-friendly. For short board content (one or two lines) prefer 1-3 short sentences that summarize or clarify the board.
    - If the BOARD contains a multi-step derivation or a sequence of numbered/line-by-line steps (three or more lines or multiple display equations), the SPEAK: block must provide a brief plain-language explanation for each major step: one short sentence per line/equation. Keep each sentence simple and focused (avoid introducing new notation).
    - Do not stop SPEAK: until all major steps have been explained. (This is the only exception to the keep responses short and concise rule.)
    - Do not include LaTeX, math symbols, or notation in SPEAK: — describe math in plain language (e.g., 'one half', 'x squared', 'plus', 'minus').
    - When a single-letter identifier (like A, a, x, y) appears as a mathematical symbol in SPEAK:, surround it with hyphens to make it distinct from ordinary words. Example: "she is an -A- student" vs "it's a good day".

Strict format rules (follow exactly):
 - The entire model output must be exactly: BOARD[...]
    SPEAK: ...
 - No extra text before BOARD or after SPEAK: and no additional BOARD or SPEAK tokens anywhere.
 - Never interleave blocks (for example: BOARD then SPEAK then BOARD). All board content must be inside the single BOARD block.

Math verbalization rules for SPEAK:
 - Only verbalize math when needed to aid understanding.
 - Rewrite math using plain words: '1/2' → 'one half'; 'x^2' → 'x squared'; '+' → 'plus'; '/' or '÷' → 'divided by'.
 - Do not use symbols like $, \\, ^, _, or raw LaTeX in SPEAK:.

If the user asks for code, examples, or formats, still adhere to the BOARD[...] / SPEAK: single-block rule; use BOARD for any content meant for the board and SPEAK for spoken explanation.

Example valid response format:

BOARD[Newton's second law:\n$$F = ma$$]

SPEAK: Newton's second law says that the force on an object equals its mass times its acceleration; this relates how mass and acceleration determine the force.

Be concise, helpful, and keep the front-end parsing in mind at all times.
"""

def text_to_speech(text):
    speech_config = speechsdk.SpeechConfig(subscription=SPEECH_KEY, region=SPEECH_REGION)
    speech_config.speech_synthesis_voice_name = "en-GB-LibbyNeural"
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

# Calibration page
@app.route('/calibration')
def calibration():
    return render_template('calibration.html')

# Main app page (only accessible after calibration)
@app.route('/learn')
def learn():
    if not session.get('calibrated'):
        return redirect(url_for('calibration'))
    return render_template('index.html')

def generate_response(prompt):
    try:
        # Build conversation context from session history (if present).
        # Keep up to the last 10 messages (approx. 5 turns) and truncate each message to avoid large cookies.
        history = session.get('chat_history', []) if session is not None else []
        def _truncate(s, limit=1500):
            s = str(s)
            return s if len(s) <= limit else s[:limit] + '...'

        history_text = ''
        if history:
            # present history in chronological order
            parts = []
            for m in history:
                role = m.get('role', 'user')
                text = _truncate(m.get('text', ''), 1200)
                if role == 'assistant':
                    parts.append('Assistant: ' + text)
                else:
                    parts.append('User: ' + text)
            history_text = '\n\n'.join(parts)

        # Prepend system prompt to guide model behavior. Gemini client expects text content,
        # so send a single concatenated string. Include recent history before the new user prompt.
        combined_prompt = SYSTEM_PROMPT
        if history_text:
            combined_prompt += "\n\nConversation history (most recent first):\n" + history_text
        combined_prompt += "\n\nUser: " + str(prompt)

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
        # Append to session chat history (simple memory). Keep last 10 messages (approx 5 turns).
        try:
            if session is not None:
                hist = session.get('chat_history', [])
                # append user then assistant (truncate each to avoid giant sessions)
                def _t(s, lim=1200):
                    s = str(s)
                    return s if len(s) <= lim else s[:lim] + '...'
                hist.append({'role': 'user', 'text': _t(user_input)})
                hist.append({'role': 'assistant', 'text': _t(ai_response)})
                # keep only last 10 messages
                if len(hist) > 10:
                    hist = hist[-10:]
                session['chat_history'] = hist
        except Exception:
            pass
        return jsonify(resp)
    else:
        return jsonify({'error': 'Failed to synthesize speech'}), 500


@app.route('/greeting')
def greeting():
    # Updated greeting: explain scrollable board
    greet_spoken = (
        "Hello! My name is Eva, your digital AI tutor. Next to me is a scrollable board. "
        "This board will be used for notes and equations as we learn together. "
        "If the content is too large to fit, you can hover your mouse over the board and scroll to see everything. "
        "What would you like to learn today?"
    )
    board_text = (
        "Welcome to your AI tutor\n"
        "Note: Sometimes the entire content won't fit, so hover your mouse over the board and scroll to see more.\n"
        "We apologise for the inconvenience. Automatic scrolling is coming soon!"
    )
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