from flask import Flask, render_template, request, jsonify, send_file
import azure.cognitiveservices.speech as speechsdk
import google.generativeai as genai
import os
import tempfile
import uuid
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Configure API keys
SPEECH_KEY = os.getenv("SPEECH_KEY")
SPEECH_REGION = os.getenv("SPEECH_REGION")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Configure Gemini
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-pro-latest')

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

@app.route('/')
def home():
    return render_template('index.html')

def generate_response(prompt):
    try:
        response = model.generate_content(prompt)
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

    # Convert AI response to speech
    audio_file, visemes = text_to_speech(ai_response)
    if audio_file:
        return jsonify({
            'success': True,
            'audio_url': f'/audio/{os.path.basename(audio_file)}',
            'visemes': visemes
        })
    else:
        return jsonify({'error': 'Failed to synthesize speech'}), 500

@app.route('/audio/<filename>')
def serve_audio(filename):
    return send_file(os.path.join(tempfile.gettempdir(), filename))

if __name__ == '__main__':
    app.run(debug=True)