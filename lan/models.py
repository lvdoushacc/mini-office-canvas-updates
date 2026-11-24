import time
import socket
import uuid
import random
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field, asdict

def get_local_lan_ip() -> str:
    """智能获取本机真实物理局域网 IP 地址，自动过滤代理/VPN/Clash TUN/虚拟网卡/回环/APIPA 地址"""
    # 1. 优先使用 psutil 深度探测物理网卡与状态
    try:
        import psutil
        stats = psutil.net_if_stats()
        addrs = psutil.net_if_addrs()
        
        candidates = []
        for iface, addr_list in addrs.items():
            stat = stats.get(iface)
            is_up = stat.isup if stat else False
            iface_lower = iface.lower()
            # 标记并过滤代理、虚拟网卡与容器网络
            is_virtual = any(k in iface_lower for k in [
                'meta', 'clash', 'tun', 'tap', 'wsl', 'docker', 'vpn',
                'vethernet', 'wireguard', 'tailscale', 'zerotier', 'loopback', 'hyper-v'
            ])
            
            for a in addr_list:
                if a.family == socket.AF_INET:
                    ip = str(a.address).strip()
                    # 严格排除回环(127.)、APIPA(169.254.)、基准测试代理网段(198.18.)与全0
                    if (
                        ip.startswith('127.')
                        or ip.startswith('169.254.')
                        or ip.startswith('198.18.')
                        or ip == '0.0.0.0'
                    ):
                        continue
                    
                    if ip.startswith(('192.168.', '10.', '172.')):
                        priority = 0
                        if is_up:
                            priority += 30
                        if not is_virtual:
                            priority += 40
                        if any(k in iface_lower for k in ['wlan', 'wi-fi', 'wifi', 'eth', 'ethernet', '以太网', '本地连接']):
                            priority += 20
                        candidates.append((priority, ip, iface))
        if candidates:
            candidates.sort(key=lambda x: x[0], reverse=True)
            return candidates[0][1]
    except Exception:
        pass

    # 2. 回退机制：解析 Windows ipconfig 命令输出
    try:
        import subprocess
        import re
        out = subprocess.check_output('ipconfig', encoding='gbk', errors='ignore')
        ips = re.findall(r'IPv4[^\d]+(\d+\.\d+\.\d+\.\d+)', out)
        valid = [
            ip.strip() for ip in ips
            if not ip.strip().startswith(('127.', '169.254.', '198.18.', '0.0.0.0'))
        ]
        lan_ips = [ip for ip in valid if ip.startswith(('192.168.', '10.', '172.'))]
        if lan_ips:
            return lan_ips[0]
        if valid:
            return valid[0]
    except Exception:
        pass

    # 3. 基础套接字兜底
    candidates = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith(('127.', '169.254.', '198.18.')):
            candidates.append(ip)
    except Exception:
        pass

    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if ip and not ip.startswith(('127.', '169.254.', '198.18.')):
                candidates.append(ip)
    except Exception:
        pass

    for ip in candidates:
        if ip.startswith(('192.168.', '10.', '172.')):
            return ip
    if candidates:
        return candidates[0]
    return '127.0.0.1'

HOST_COLOR = "#f59e0b"  # 房主专属琥珀金/皇冠色
MEMBER_COLORS = [
    "#3b82f6",  # 科技蓝
    "#8b5cf6",  # 优雅紫
    "#10b981",  # 翡翠绿
    "#f43f5e",  # 玫瑰红
    "#06b6d4",  # 明亮青
    "#6366f1",  # 经典靛
    "#f97316",  # 活力橙
    "#14b8a6",  # 翠松绿
]

@dataclass
class MemberInvite:
    invite_id: str
    code: str
    display_name: str
    member_id: str
    color: str
    enabled: bool = True
    created_at: int = field(default_factory=lambda: int(time.time() * 1000))
    last_used_at: Optional[int] = None
    bound_device_id: Optional[str] = None  # 预留设备绑定结构

    def to_dict(self, include_code: bool = True) -> Dict[str, Any]:
        data = {
            'inviteId': self.invite_id,
            'displayName': self.display_name,
            'memberId': self.member_id,
            'color': self.color,
            'enabled': self.enabled,
            'createdAt': self.created_at,
            'lastUsedAt': self.last_used_at,
            'boundDeviceId': self.bound_device_id,
        }
        if include_code:
            data['code'] = self.code
        return data

@dataclass
class MemberSession:
    session_id: str
    member_id: str
    device_id: str
    device_name: str
    joined_at: int = field(default_factory=lambda: int(time.time() * 1000))
    last_seen: float = field(default_factory=lambda: time.time())

    def to_dict(self) -> Dict[str, Any]:
        return {
            'sessionId': self.session_id,
            'memberId': self.member_id,
            'deviceId': self.device_id,
            'deviceName': self.device_name,
            'joinedAt': self.joined_at,
            'lastSeen': self.last_seen,
        }

@dataclass
class RoomMember:
    member_id: str
    display_name: str
    color: str
    role: str = "member"  # "host" | "member"
    device_id: str = ""
    device_name: str = ""
    online: bool = False
    current_session_id: Optional[str] = None
    joined_at: int = field(default_factory=lambda: int(time.time() * 1000))
    last_seen: float = field(default_factory=lambda: time.time())

    @property
    def is_host(self) -> bool:
        return self.role == "host"

    @property
    def name(self) -> str:
        return self.display_name

    def to_dict(self) -> Dict[str, Any]:
        return {
            'memberId': self.member_id,
            'displayName': self.display_name,
            'name': self.display_name,
            'color': self.color,
            'role': self.role,
            'isHost': self.is_host,
            'deviceId': self.device_id,
            'deviceName': self.device_name,
            'online': self.online,
            'currentSessionId': self.current_session_id,
            'joinedAt': self.joined_at,
            'lastSeen': self.last_seen,
        }

@dataclass
class Room:
    room_id: str
    project_id: str
    canvas_id: str
    host_member_id: str
    host_name: str
    host_ip: str
    port: int
    created_at: int
    status: str = "open"
    project_name: str = ''
    canvas_title: str = ''
    passcode: str = ''  # 仅作旧版本接口兼容回退，不再作为主凭据
    invites: Dict[str, MemberInvite] = field(default_factory=dict)
    members: Dict[str, RoomMember] = field(default_factory=dict)
    sessions: Dict[str, MemberSession] = field(default_factory=dict)

    @property
    def host_id(self) -> str:
        return self.host_member_id

    def to_host_dict(self) -> Dict[str, Any]:
        return {
            'roomId': self.room_id,
            'projectId': self.project_id,
            'canvasId': self.canvas_id,
            'hostId': self.host_member_id,
            'hostMemberId': self.host_member_id,
            'hostName': self.host_name,
            'hostIp': self.host_ip,
            'port': self.port,
            'createdAt': self.created_at,
            'status': self.status,
            'passcode': self.passcode,
            'requiresPasscode': bool(self.passcode and self.passcode.strip()),
            'projectName': self.project_name,
            'canvasTitle': self.canvas_title,
            'invites': [inv.to_dict(include_code=True) for inv in self.invites.values()],
            'members': [m.to_dict() for m in self.members.values()]
        }

    def to_public_dict(self) -> Dict[str, Any]:
        return {
            'roomId': self.room_id,
            'hostName': self.host_name,
            'projectName': self.project_name,
            'hostIp': self.host_ip,
            'port': self.port,
            'status': self.status,
            'requiresPasscode': bool(self.passcode and self.passcode.strip())
        }

    def to_broadcast_dict(self) -> Dict[str, Any]:
        # 绝不广播任何邀请码、PIN 或成员敏感数据
        return {
            'app': 'xiaoxiao-shop-lan',
            'version': '1.2',
            'roomId': self.room_id,
            'hostName': self.host_name,
            'projectName': self.project_name,
            'hostIp': self.host_ip,
            'port': self.port,
            'status': self.status,
            'requiresPasscode': bool(self.passcode and self.passcode.strip())
        }
