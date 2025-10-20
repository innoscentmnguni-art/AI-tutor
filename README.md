# AI Tutor

## Overview
AI Tutor is a Flask-based web application that uses gaze tracking and speech services to create an interactive digital tutor experience.

## Prerequisites
- **Python 3.10 or higher** (recommended: Python 3.12)
- **pip** (Python package manager)
- **Git** (for cloning the repository)
- **Webcam** (for gaze tracking features)
- **Internet connection** (for speech and AI services)

## Setup Instructions

1. **Clone the repository:**
   ```sh
   git clone https://github.com/innoscentmnguni-art/AI-tutor.git
   cd AI-tutor
   ```

2. **Create a virtual environment:**
   ```sh
   python -m venv .venv
   .venv\Scripts\activate  # On Windows
   # Or
   source .venv/bin/activate  # On Mac/Linux
   ```

3. **Install dependencies:**
   ```sh
   pip install -r requirements.txt
   ```

4. **Configure environment variables:**
   - Create a `.env` file in the project root with the following content:
     ```
     GEMINI_API_KEY=your_gemini_api_key
     SPEECH_KEY=your_azure_speech_key
     SPEECH_REGION=your_azure_region
     ```
   - **Do not commit your `.env` file to git.**

5. **Run the application:**
   ```sh
   .venv\Scripts\python app.py  # On Windows
   # Or
   python app.py  # On Mac/Linux
   ```
   - The app will start on `http://127.0.0.1:5000` by default.

## Usage
- Open your browser and go to `http://127.0.0.1:5000`.
- Follow the on-screen instructions to calibrate gaze tracking and start learning.

## Notes
- For speech and AI features, valid API keys are required in your `.env` file.
- If you encounter issues with dependencies, ensure your Python version is compatible and all packages in `requirements.txt` are installed.
- For development, run Flask in debug mode:
  ```sh
  .venv\Scripts\python -m flask --debug run
  ```

## Troubleshooting
- **Webcam not detected:** Ensure your browser has permission to access the webcam.
- **API errors:** Double-check your API keys and region in `.env`.
- **Dependency issues:** Run `pip install --upgrade pip` and reinstall requirements.

## License
This project is licensed under the MIT License.
