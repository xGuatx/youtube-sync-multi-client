FROM python:3.12-slim

WORKDIR /app

# Installer les dependances systeme necessaires
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Installer yt-dlp via pip pour avoir la derniere version
RUN pip install --no-cache-dir yt-dlp

# Copier et installer les dependances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier le code source
COPY app.py .

EXPOSE 5000

# Utiliser gunicorn pour la production
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "30", "app:app"]