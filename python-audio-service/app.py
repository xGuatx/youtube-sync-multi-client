#!/usr/bin/env python3
"""
Service Python pour l'extraction audio YouTube
Utilise yt-dlp pour obtenir les URLs audio directes
"""

from flask import Flask, jsonify, request
import subprocess
import json
import logging
import sys
import re
from urllib.parse import urlparse

app = Flask(__name__)

# Configuration logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class YouTubeAudioExtractor:
    def __init__(self):
        logger.info(" Initialisation de l'extracteur audio YouTube avec yt-dlp")
        
    def get_audio_url(self, video_id):
        """
        Extrait l'URL audio directe d'une video via yt-dlp avec fallback multi-clients
        """
        # Strategies de clients a essayer dans l'ordre
        strategies = [
            {'name': 'web', 'args': []},  # Client web par defaut (TVHTML5)
            {'name': 'ios', 'args': ['--extractor-args', 'youtube:player_client=ios']},  # Client iOS (contourne certains blocks)
            {'name': 'mweb', 'args': ['--extractor-args', 'youtube:player_client=mweb']},  # Client mobile web
        ]

        youtube_url = f"https://www.youtube.com/watch?v={video_id}"
        last_error = None

        for strategy in strategies:
            try:
                logger.info(f" Tentative extraction avec client {strategy['name']} pour: {video_id}")

                # Construire la commande yt-dlp
                cmd = [
                    'yt-dlp',
                    '--format', 'bestaudio[ext=webm][acodec=opus]/bestaudio[ext=m4a][acodec^=mp4a]/bestaudio',
                    *strategy['args'],  # Ajouter les args specifiques au client
                    '--get-url',
                    '--get-title',
                    '--get-duration',
                    '--no-playlist',
                    '--no-check-certificates',
                    '--prefer-free-formats',
                    '--quiet',
                    youtube_url
                ]

                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                if result.returncode != 0:
                    error_msg = result.stderr.strip()
                    logger.warning(f" Client {strategy['name']} echoue: {error_msg}")
                    last_error = error_msg
                    continue  # Essayer la strategie suivante

                lines = result.stdout.strip().split('\n')
                if len(lines) < 3:
                    logger.warning(f" Client {strategy['name']} reponse invalide: {len(lines)} lignes")
                    last_error = f"Reponse inattendue: {len(lines)} lignes"
                    continue

                # L'ordre reel est: titre, URL, duree
                title = lines[0].strip()
                audio_url = lines[1].strip()
                duration_str = lines[2].strip()

                # Verifier si on a recu une vraie URL audio
                if not audio_url.startswith('http') or 'storyboard' in audio_url or '.jpg' in audio_url:
                    logger.warning(f" Client {strategy['name']} a retourne une URL invalide")
                    last_error = "URL audio invalide ou bloquee"
                    continue

                # Succes ! Extraire les infos
                duration = self._parse_duration(duration_str)
                format_info = self._get_format_info(audio_url)

                result_data = {
                    'success': True,
                    'audio_url': audio_url,
                    'title': title,
                    'duration': duration,
                    'format': format_info['format'],
                    'content_type': format_info['content_type'],
                    'bitrate': 'variable',
                    'quality': 'audio-only',
                    'client': strategy['name']
                }

                logger.info(f" Extraction reussie avec client {strategy['name']}: {title} ({duration}s)")
                return result_data

            except subprocess.TimeoutExpired:
                logger.warning(f" Timeout avec client {strategy['name']}")
                last_error = "Timeout"
                continue
            except Exception as e:
                logger.warning(f" Erreur avec client {strategy['name']}: {str(e)}")
                last_error = str(e)
                continue

        # Toutes les strategies ont echoue
        logger.error(f" Echec extraction {video_id} avec tous les clients. Derniere erreur: {last_error}")
        return {
            'success': False,
            'error': f'Extraction echouee: {last_error}',
            'audio_url': None
        }
    
    def _parse_duration(self, duration_str):
        """
        Parse la duree au format MM:SS ou HH:MM:SS vers secondes
        """
        try:
            if not duration_str or duration_str == 'NA':
                return 0
            
            parts = duration_str.split(':')
            if len(parts) == 2:  # MM:SS
                return int(parts[0]) * 60 + int(parts[1])
            elif len(parts) == 3:  # HH:MM:SS
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
            else:
                return 0
        except (ValueError, IndexError):
            logger.warning(f" Impossible de parser la duree: {duration_str}")
            return 0
    
    def _get_format_info(self, url):
        """
        Determine le format et content-type a partir de l'URL
        """
        if 'mime=audio%2Fm4a' in url or '.m4a' in url:
            return {
                'format': 'm4a',
                'content_type': 'audio/m4a'
            }
        elif 'mime=audio%2Fwebm' in url or '.webm' in url:
            return {
                'format': 'webm',
                'content_type': 'audio/webm'
            }
        elif 'mime=audio%2Fmp4' in url or '.mp4' in url:
            return {
                'format': 'mp4',
                'content_type': 'audio/mp4'
            }
        else:
            return {
                'format': 'audio',
                'content_type': 'audio/mpeg'
            }

# Instance globale
extractor = YouTubeAudioExtractor()

@app.route('/health', methods=['GET'])
def health_check():
    """Endpoint de sante du service"""
    try:
        # Test basique de yt-dlp
        result = subprocess.run(['yt-dlp', '--version'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return jsonify({
                'status': 'healthy',
                'service': 'youtube-audio-extractor',
                'yt_dlp_version': result.stdout.strip(),
                'timestamp': str(subprocess.run(['date'], capture_output=True, text=True).stdout.strip())
            })
        else:
            return jsonify({
                'status': 'unhealthy',
                'error': 'yt-dlp not working'
            }), 500
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'error': str(e)
        }), 500

@app.route('/extract/<video_id>', methods=['GET'])
def extract_audio(video_id):
    """Endpoint principal pour l'extraction audio"""
    
    # Validation de l'ID YouTube
    if not re.match(r'^[a-zA-Z0-9_-]{11}$', video_id):
        return jsonify({
            'success': False,
            'error': 'ID YouTube invalide'
        }), 400
    
    try:
        result = extractor.get_audio_url(video_id)
        
        if result['success']:
            return jsonify(result)
        else:
            return jsonify(result), 404
            
    except Exception as e:
        logger.error(f" Erreur endpoint extraction: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Erreur serveur: {str(e)}'
        }), 500

@app.route('/info/<video_id>', methods=['GET'])
def get_video_info(video_id):
    """Endpoint pour obtenir uniquement les infos sans URL audio"""
    
    if not re.match(r'^[a-zA-Z0-9_-]{11}$', video_id):
        return jsonify({
            'success': False,
            'error': 'ID YouTube invalide'
        }), 400
    
    try:
        youtube_url = f"https://www.youtube.com/watch?v={video_id}"
        
        cmd = [
            'yt-dlp',
            '--get-title',
            '--get-duration',
            '--get-description',
            '--no-playlist',
            '--quiet',
            youtube_url
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        
        if result.returncode != 0:
            return jsonify({
                'success': False,
                'error': 'Video non accessible'
            }), 404
        
        lines = result.stdout.strip().split('\n')
        
        return jsonify({
            'success': True,
            'title': lines[0] if len(lines) > 0 else 'Titre inconnu',
            'duration': extractor._parse_duration(lines[1]) if len(lines) > 1 else 0,
            'description': lines[2] if len(lines) > 2 else ''
        })
        
    except Exception as e:
        logger.error(f" Erreur info video: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'success': False,
        'error': 'Endpoint non trouve'
    }), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        'success': False,
        'error': 'Erreur interne du serveur'
    }), 500

if __name__ == '__main__':
    logger.info(" Demarrage du service d'extraction audio YouTube")
    app.run(host='0.0.0.0', port=5000, debug=False)