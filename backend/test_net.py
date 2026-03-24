import socket
import sys

def test_connection(ip, port):
    print(f"Testing connection to {ip}:{port}...")
    try:
        # Create a socket object
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(5) # 5 seconds timeout
        
        # Try to connect
        result = s.connect_ex((ip, port))
        
        if result == 0:
            print(f"SUCCESS: Port {port} is OPEN on {ip}")
            return True
        else:
            print(f"FAILED: Connection to {ip}:{port} failed with error code {result}")
            # Error 10060 is timeout, 10061 is refused
            return False
    except Exception as e:
        print(f"ERROR: {e}")
        return False
    finally:
        s.close()

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python test_net.py <ip> <port>")
    else:
        test_connection(sys.argv[1], int(sys.argv[2]))
