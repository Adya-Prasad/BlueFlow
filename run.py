"""BlueFlow — Entry point.

Starts the HTTPS server with self-signed certificate,
generates a QR code for phone connection, and opens the dashboard.
"""

import uvicorn
import socket
import os
import sys
import webbrowser
import threading
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("BlueFlow")


def get_local_ip():
    """Get this machine's LAN IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def generate_qr(url, output_path):
    """Generate a QR code image for the given URL."""
    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=10, border=2)
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#1042af", back_color="white")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        img.save(output_path)
        logger.info(f"QR code saved to {output_path}")
    except ImportError:
        logger.warning("qrcode package not installed — QR code not generated")


def main():
    from server.config import PORT, CERT_DIR

    ip = get_local_ip()
    port = PORT

    # Generate SSL certificate
    from server.ssl_manager import generate_self_signed_cert
    cert_path, key_path = generate_self_signed_cert(ip, CERT_DIR)

    # Generate QR code
    phone_url = f"https://{ip}:{port}/phone"
    generate_qr(phone_url, os.path.join(CERT_DIR, "qr.png"))

    # Print banner
    print()
    print(f"  ║  Dashboard:  https://localhost:{port}             ║")
    print(f"  ║  Phone URL:  {phone_url:<37s} ║")
    print("  ║                                                   ║")
    print("  ║  Scan the QR code on the dashboard to connect     ║")
    print("  ║  your phone. Both devices must be on same WiFi.   ║")
  

    # Open dashboard in browser after a short delay
    dashboard_url = f"https://localhost:{port}"
    threading.Timer(2.5, lambda: webbrowser.open(dashboard_url)).start()

    # Start server
    uvicorn.run(
        "server.app:app",
        host="0.0.0.0",
        port=port,
        ssl_keyfile=key_path,
        ssl_certfile=cert_path,
        log_level="warning",
    )

if __name__ == "__main__":
    main()
