# Scaler AI Lecture Script Generator

A multi-agent authoring, memory ledger, and quality audit platform designed to generate 90-minute masterclass lecture scripts following the 6-Part Script Anatomy (*Why -> What -> How -> Where -> What breaks*).

---

## Architecture Overview

- **Frontend**: Lightweight vanilla ES6 client (`frontend/index.html`, `frontend/app.js`, `frontend/styles.css`) featuring:
  - Cascading curriculum browser (Programs -> Tracks -> Modules -> Classes).
  - Sequential Card-by-Card GTG authoring workflow.
  - Interactive multi-lens audit panels, Mermaid diagrams, animations, and checkpoint quizzes.
  - Dynamic script exports (`.ipynb`, `.doc`, `.md`, `.py`, `.pdf`, `.txt`).
- **Backend**: FastAPI ASGI application (`backend/main.py`) running on Python 3.11+.
- **Multi-Agent Pipeline**:
  - `agents/shared_context.py`: Block A & Block B pedagogical rules injection.
  - `agents/outliner.py`: Proposes structured 90-minute lecture decks with bloom levels and time pacing.
  - `agents/writer.py`: Generates lecture dialogue, everyday analogies, code implementations, and quizzes.
  - `agents/reviewer.py`: 5-Lens quality inspection (Accuracy, Pedagogy, Engagement, Readability, Timing).
  - `agents/moderator.py`: Surgical repair of flagged cards and timing rebalance.
  - `agents/attributes_generator.py`: Generates Mermaid flowcharts, SVG architectural infographics, and interactive HTML simulations.
- **Database**: SQLite with SQLAlchemy ORM (`models.py`, `database.py`).

---

## Local Development Setup

### 1. Prerequisites
- Python 3.10+ (Recommended Python 3.11)
- Git

### 2. Clone Repository & Setup Virtual Environment
```bash
git clone <your-repo-url>
cd Script_Generator

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On Linux / macOS:
source venv/bin/activate
```

### 3. Install Dependencies
```bash
pip install -r backend/requirements.txt
```

### 4. Configure Environment Variables
Copy `.env.example` to `backend/.env` and insert your API keys:
```bash
cp .env.example backend/.env
```
Key variables:
- `ANTHROPIC_API_KEY`: Required if using Claude.
- `GROQ_API_KEY`: Required if using Groq.
- `EXECUTION_MODE`: `live` (calls real LLM APIs) or `mock` (deterministic test outputs).

### 5. Seed the Curriculum Database (If needed)
```bash
cd backend
python -m seed_curriculum
```

### 6. Run the Application
```bash
cd backend
python -m uvicorn main:app --reload --port 8000
```
Open your browser at `http://localhost:8000` to access the full UI and backend APIs.

---

## Deployment to Railway

This project is pre-configured with:
- `railway.toml`: Automatic build & startup instructions.
- `Procfile`: Uvicorn runner mapping dynamically to `${PORT}`.
- `Dockerfile`: Production multi-stage container.

### Step-by-Step Railway Deployment:
1. Push your code to a GitHub repository.
2. Log into [Railway.app](https://railway.app/).
3. Click **"New Project"** -> **"Deploy from GitHub repo"** and select your repository.
4. Go to the project **Variables** tab on Railway and add:
   - `ANTHROPIC_API_KEY`: Your Claude API key.
   - `EXECUTION_MODE`: `live`
   - `PORT`: `8000` (Railway injects this automatically, but good practice).
   - *(Optional)* `GROQ_API_KEY` if testing with Groq.
5. In the **Settings** tab -> **Networking**, click **"Generate Domain"** to get a public URL (e.g., `https://script-generator-production.up.railway.app`).
6. Open your public domain. The frontend UI and backend API will be live automatically.

---

## Security & Secrets
- Never commit `backend/.env` to GitHub. The included `.gitignore` protects secrets, runtime database write-ahead logs (`*.db-wal`), and virtual environments.
