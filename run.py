import os
from dotenv import load_dotenv
from app import create_app

load_dotenv()
app = create_app()

if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true", port=int(os.getenv("PORT", "5001")))
