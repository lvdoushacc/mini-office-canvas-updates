import json
import socket
import time
import threading
import os
from typing import Dict, Any, List, Optional, Callable

DISCOVERY_PORT = int(os.getenv('LAN_DISCOVERY_PORT', '41888'))
BROADCAST_INTERVAL = 2.0  # 低频广播：每 2 秒一次

def _get_subnet_broadcast_addresses() -> List[str]:
    """获取所有活动局域网网卡的定向子网广播地址（如 192.168.31.255），确保穿透多网卡"""
    broadcasts = set()
    try:
        import psutil
        import ipaddress
        stats = psutil.net_if_stats()
        addrs = psutil.net_if_addrs()
        for iface, addr_list in addrs.items():
            stat = stats.get(iface)
            if stat and not stat.isup:
                continue
            iface_lower = iface.lower()
            if any(k in iface_lower for k in ['meta', 'clash', 'tun', 'tap', 'wsl', 'docker', 'vpn', 'vethernet', 'wireguard', 'tailscale', 'zerotier', 'loopback']):
                continue
            for a in addr_list:
                if a.family == socket.AF_INET:
                    ip = str(a.address).strip()
                    mask = str(a.netmask).strip() if a.netmask else ""
                    if ip.startswith(('127.', '169.254.', '198.18.', '0.0.0.0')):
                        continue
                    if mask:
                        try:
                            net = ipaddress.IPv4Network(f"{ip}/{mask}", strict=False)
                            broadcasts.add(str(net.broadcast_address))
                        except Exception:
                            pass
    except Exception:
        pass
    return list(broadcasts)

class UDPDiscoveryBroadcaster:
    def __init__(self, get_payload_func: Callable[[], Optional[Dict[str, Any]]], port: int = DISCOVERY_PORT):
        self.get_payload_func = get_payload_func
        self.port = port
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread and self._thread.is_alive():
            try:
                self._thread.join(timeout=1.0)
            except Exception:
                pass
        self._thread = None

    def _run(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(0.5)

        ports = [self.port]
        if self.port != 39123:
            ports.append(39123)

        targets = []
        while self._running:
            try:
                payload = self.get_payload_func()
                if payload:
                    # 确保严格限定广播字段：绝不包含 passcode, canvas, secret, token
                    safe_data = {
                        'app': str(payload.get('app', 'xiaoxiao-shop-lan')),
                        'version': str(payload.get('version', '1.0')),
                        'roomId': str(payload.get('roomId', '')),
                        'hostName': str(payload.get('hostName', '')),
                        'projectName': str(payload.get('projectName', '')),
                        'hostIp': str(payload.get('hostIp', '')),
                        'port': int(payload.get('port', 8910)),
                        'status': str(payload.get('status', 'open'))
                    }
                    raw_bytes = json.dumps(safe_data).encode('utf-8')

                    # 动态生成多目标：物理子网定向广播 + 全局广播 + 本地回环
                    targets = [
                        ('255.255.255.255', p) for p in ports
                    ] + [
                        ('127.0.0.1', p) for p in ports
                    ]
                    for bcast_ip in _get_subnet_broadcast_addresses():
                        for p in ports:
                            targets.append((bcast_ip, p))

                    for target in targets:
                        try:
                            sock.sendto(raw_bytes, target)
                        except Exception:
                            pass
            except Exception:
                pass

            # 睡眠 2 秒，可响应中断
            for _ in range(20):
                if not self._running:
                    break
                time.sleep(0.1)

        # 退出前发送一次 closed 状态广播
        try:
            payload = self.get_payload_func()
            if payload:
                safe_data = {
                    'app': str(payload.get('app', 'xiaoxiao-shop-lan')),
                    'version': str(payload.get('version', '1.0')),
                    'roomId': str(payload.get('roomId', '')),
                    'hostName': str(payload.get('hostName', '')),
                    'projectName': str(payload.get('projectName', '')),
                    'hostIp': str(payload.get('hostIp', '')),
                    'port': int(payload.get('port', 8900)),
                    'status': 'closed'
                }
                raw_bytes = json.dumps(safe_data).encode('utf-8')
                for target in targets:
                    try:
                        sock.sendto(raw_bytes, target)
                    except Exception:
                        pass
        except Exception:
            pass

        try:
            sock.close()
        except Exception:
            pass

class UDPDiscoveryListener:
    def __init__(self, port: int = DISCOVERY_PORT):
        self.port = port
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._discovered_rooms: Dict[str, Dict[str, Any]] = {}

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread and self._thread.is_alive():
            try:
                self._thread.join(timeout=1.0)
            except Exception:
                pass
        self._thread = None

    def _run(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, 'SO_REUSEPORT'):
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except Exception:
                pass

        try:
            sock.bind(('', self.port))
            sock.settimeout(1.0)
        except Exception as e:
            # 端口绑定失败（如权限问题），仍保持线程静默
            try:
                sock.close()
            except Exception:
                pass
            return

        while self._running:
            try:
                data, addr = sock.recvfrom(2048)
                msg = json.loads(data.decode('utf-8'))
                if isinstance(msg, dict) and msg.get('app') == 'xiaoxiao-shop-lan':
                    room_id = msg.get('roomId')
                    status = msg.get('status', 'open')
                    if room_id:
                        with self._lock:
                            if status == 'closed':
                                self._discovered_rooms.pop(room_id, None)
                            else:
                                sender_ip = addr[0]
                                host_ip = msg.get('hostIp') or sender_ip
                                if (
                                    host_ip in ('127.0.0.1', 'localhost', '0.0.0.0')
                                    or host_ip.startswith(('198.18.', '169.254.'))
                                ):
                                    host_ip = sender_ip
                                self._discovered_rooms[room_id] = {
                                    'roomId': room_id,
                                    'hostName': msg.get('hostName', '局域网主机'),
                                    'projectName': msg.get('projectName', '未命名项目'),
                                    'hostIp': host_ip,
                                    'port': int(msg.get('port', 8910)),
                                    'status': status,
                                    'lastSeen': time.time()
                                }
            except (socket.timeout, json.JSONDecodeError):
                pass
            except Exception:
                pass

            # 清理 6 秒未收到广播的房间
            now = time.time()
            with self._lock:
                expired = [rid for rid, r in self._discovered_rooms.items() if now - r.get('lastSeen', 0) > 6.0]
                for rid in expired:
                    del self._discovered_rooms[rid]

        try:
            sock.close()
        except Exception:
            pass

    def get_rooms(self) -> List[Dict[str, Any]]:
        now = time.time()
        with self._lock:
            # 过滤超期
            valid = []
            expired = []
            for rid, r in self._discovered_rooms.items():
                if now - r.get('lastSeen', 0) <= 6.0 and r.get('status') == 'open':
                    valid.append({
                        'roomId': r['roomId'],
                        'hostName': r['hostName'],
                        'projectName': r['projectName'],
                        'hostIp': r['hostIp'],
                        'port': r['port'],
                        'status': r['status']
                    })
                else:
                    expired.append(rid)
            for rid in expired:
                del self._discovered_rooms[rid]
            return sorted(valid, key=lambda x: x.get('roomId', ''))
