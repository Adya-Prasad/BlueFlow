"""Self-signed SSL certificate generator for local HTTPS.

HTTPS is required because phone browsers need a secure context
for getUserMedia() (microphone access) and AudioWorklet.
"""

import os
import datetime
import ipaddress
import logging

logger = logging.getLogger(__name__)


def generate_self_signed_cert(local_ip, cert_dir="certs"):
    """Generate a self-signed SSL certificate with the local IP as SAN.
    
    Returns (cert_path, key_path). Reuses existing certs if present.
    """
    os.makedirs(cert_dir, exist_ok=True)
    cert_path = os.path.join(cert_dir, "cert.pem")
    key_path = os.path.join(cert_dir, "key.pem")

    if os.path.exists(cert_path) and os.path.exists(key_path):
        logger.info("Using existing SSL certificates")
        return cert_path, key_path

    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        logger.info("Generating self-signed SSL certificate...")

        # Generate RSA key
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, "BlueFlow"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "BlueFlow"),
        ])

        # Include localhost and the LAN IP so both work
        san = x509.SubjectAlternativeName([
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
            x509.IPAddress(ipaddress.IPv4Address(local_ip)),
        ])

        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.utcnow())
            .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=365))
            .add_extension(san, critical=False)
            .sign(key, hashes.SHA256())
        )

        with open(key_path, "wb") as f:
            f.write(key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            ))

        with open(cert_path, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))

        logger.info(f"SSL certificate generated for {local_ip}")
        return cert_path, key_path

    except ImportError:
        logger.error(
            "cryptography package not installed. Run: pip install cryptography"
        )
        raise
    except Exception as e:
        logger.error(f"Failed to generate SSL certificate: {e}")
        raise
