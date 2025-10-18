from flask import Flask, render_template, request, jsonify, send_file
import azure.cognitiveservices.speech as speechsdk
import os
import tempfile
import uuid

app = Flask(__name__)

# Replace with your Azure Speech Service subscription key and region
SPEECH_KEY = ""
SPEECH_REGION = ""

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

@app.route('/synthesize', methods=['POST'])
def synthesize():
    data = request.json
    text = data.get('text', '')

    if not text:
        return jsonify({'error': 'No text provided'}), 400

    audio_file, visemes = text_to_speech(text)
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