import time
import uuid
import random
import threading
from typing import Dict, Any, Optional, Tuple, List
from .models import (
    Room,
    RoomMember,
    MemberInvite,
    MemberSession,
    HOST_COLOR,
    MEMBER_COLORS,
    get_local_lan_ip
)
from .discovery import UDPDiscoveryBroadcaster, UDPDiscoveryListener, DISCOVERY_PORT

# 网络短暂抖动、浏览器刷新和页面恢复都不应立即让协作会话失效。
SESSION_TTL_SECONDS = 300.0

class LANManager:
    def __init__(self):
        self._lock = threading.Lock()
        self.active_room: Optional[Room] = None
        self.broadcaster: Optional[UDPDiscoveryBroadcaster] = None
        self.listener: UDPDiscoveryListener = UDPDiscoveryListener()
        # 启动自动发现监听器
        self.listener.start()

    def create_room(
        self,
        project_id: str,
        canvas_id: str,
        project_name: str,
        canvas_title: str,
        host_name: str = "",
        passcode: Optional[str] = "",
        port: int = 8900,
        host_ip: str = ""
    ) -> Room:
        with self._lock:
            # 如果已有房间在运行，先平滑关闭旧房间
            if self.active_room and self.active_room.status == "open":
                self._close_active_room_locked()

            room_id = f"room_{uuid.uuid4().hex[:8]}"
            host_member_id = f"host_{uuid.uuid4().hex[:8]}"
            actual_host_ip = host_ip.strip() if host_ip and host_ip.strip() else get_local_lan_ip()
            actual_host_name = host_name.strip() if host_name and host_name.strip() else "我的主机"
            if passcode is None:
                actual_passcode = ""
            else:
                p_str = str(passcode).strip()
                if not p_str or p_str.lower() == "none":
                    actual_passcode = ""
                else:
                    actual_passcode = p_str
            now_ms = int(time.time() * 1000)
            now_sec = time.time()

            host_session_id = f"sess_{uuid.uuid4().hex[:12]}"
            host_session = MemberSession(
                session_id=host_session_id,
                member_id=host_member_id,
                device_id="host_local_device",
                device_name=actual_host_name,
                joined_at=now_ms,
                last_seen=now_sec
            )

            # 主机自身作为第一个成员（专属金色）
            host_member = RoomMember(
                member_id=host_member_id,
                display_name=f"{actual_host_name} (房主)",
                color=HOST_COLOR,
                role="host",
                device_id="host_local_device",
                device_name=actual_host_name,
                online=True,
                current_session_id=host_session_id,
                joined_at=now_ms,
                last_seen=now_sec
            )

            room = Room(
                room_id=room_id,
                project_id=project_id,
                canvas_id=canvas_id,
                host_member_id=host_member_id,
                host_name=actual_host_name,
                host_ip=actual_host_ip,
                port=port,
                created_at=now_ms,
                status="open",
                passcode=actual_passcode,
                project_name=project_name or "未命名项目",
                canvas_title=canvas_title or "智能画布",
                invites={},
                members={host_member_id: host_member},
                sessions={host_session_id: host_session}
            )

            self.active_room = room

            # 启动低频广播（每 2 秒一次，严格不广播验证码或画布内容）
            self.broadcaster = UDPDiscoveryBroadcaster(
                get_payload_func=lambda: self.active_room.to_broadcast_dict() if self.active_room and self.active_room.status == "open" else None
            )
            self.broadcaster.start()

            return room

    def _get_sanitized_members(self) -> List[Dict[str, Any]]:
        """返回供协作客户端与外部消费的成员列表，严格去除 currentSessionId，绝不广播或泄露 sessionId"""
        if not self.active_room:
            return []
        sanitized = []
        for m in self.active_room.members.values():
            d = m.to_dict()
            d.pop("currentSessionId", None)
            sanitized.append(d)
        return sanitized

    def _close_active_room_locked(self):
        if self.active_room:
            self.active_room.status = "closed"
        if self.broadcaster:
            try:
                self.broadcaster.stop()
            except Exception:
                pass
            self.broadcaster = None

    def close_room(self) -> Optional[Room]:
        with self._lock:
            if not self.active_room:
                return None
            self._close_active_room_locked()
            return self.active_room

    def get_host_room(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            if not self.active_room:
                return None
            self._prune_stale_members_locked()
            d = self.active_room.to_host_dict()
            d["members"] = self._get_sanitized_members()
            if self.active_room.host_member_id in self.active_room.members:
                d["hostSessionId"] = self.active_room.members[self.active_room.host_member_id].current_session_id
            return d

    def get_public_room_info(self, room_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            if not self.active_room or self.active_room.room_id != room_id:
                return None
            return self.active_room.to_public_dict()

    def get_room_presence(self, room_id: str = "", member_id: str = "") -> Optional[Dict[str, Any]]:
        """Return the authoritative online member list for the active collaboration room."""
        with self._lock:
            room = self.active_room
            if not room or room.status != "open" or (room_id and room.room_id != str(room_id)):
                return None
            self._prune_stale_members_locked()
            members = [m for m in room.members.values() if m.online]
            members.sort(key=lambda m: (0 if m.is_host else 1, m.joined_at, m.member_id))
            peers = []
            for member in members:
                peers.append({
                    "deviceId": member.member_id,
                    "peerId": member.member_id,
                    "memberId": member.member_id,
                    "nickname": member.display_name,
                    "color": member.color,
                    "role": member.role,
                    "online": True,
                    "isLocal": member.member_id == str(member_id or ""),
                    "seatName": "房主" if member.is_host else "协作者",
                    "seatShortName": "主机" if member.is_host else "成员",
                })
            local = next((m for m in members if m.member_id == str(member_id or "")), None)
            return {
                "localDeviceId": local.member_id if local else str(member_id or room.host_member_id),
                "localNickname": local.display_name if local else room.host_name,
                "localRole": "HOST" if local and local.is_host else "WRITABLE",
                "localColor": local.color if local else "#f59e0b",
                "localSeatName": "房主" if local and local.is_host else "协作者",
                "totalOnline": len(members),
                "writableCount": len(members),
                "maxWritable": len(members),
                "isReadOnly": False,
                "peers": peers,
                "members": [m.to_dict() for m in members],
            }

    def add_invite(self, display_name: str) -> Tuple[bool, Any, int]:
        """房主为指定同事创建独立 6 位专属验证码与固定色彩身份"""
        with self._lock:
            if not self.active_room or self.active_room.status != "open":
                return False, "当前无开放的协作房间", 400

            name = display_name.strip()
            if not name:
                return False, "协作者姓名不能为空", 400

            # 检查是否已有同名成员
            for inv in self.active_room.invites.values():
                if inv.display_name == name:
                    return True, inv.to_dict(include_code=True), 200

            # 生成唯一 6 位数字验证码
            existing_codes = {inv.code for inv in self.active_room.invites.values()}
            if self.active_room.passcode:
                existing_codes.add(str(self.active_room.passcode))
            for _ in range(200):
                code = f"{random.randint(100000, 999999)}"
                if code not in existing_codes:
                    break
            else:
                code = f"{random.randint(100000, 999999)}"

            # 分配稳定 member_id 与专属颜色
            member_id = f"mem_{uuid.uuid4().hex[:8]}"
            used_colors = {inv.color for inv in self.active_room.invites.values()}
            assigned_color = None
            for c in MEMBER_COLORS:
                if c not in used_colors:
                    assigned_color = c
                    break
            if not assigned_color:
                assigned_color = MEMBER_COLORS[len(self.active_room.invites) % len(MEMBER_COLORS)]

            invite_id = f"inv_{uuid.uuid4().hex[:8]}"
            invite = MemberInvite(
                invite_id=invite_id,
                code=code,
                display_name=name,
                member_id=member_id,
                color=assigned_color,
                enabled=True
            )
            self.active_room.invites[invite_id] = invite

            # 预注册成员身份档案（初始离线 online=False）
            now_ms = int(time.time() * 1000)
            member = RoomMember(
                member_id=member_id,
                display_name=name,
                color=assigned_color,
                role="member",
                online=False,
                joined_at=now_ms,
                last_seen=0.0
            )
            self.active_room.members[member_id] = member

            return True, invite.to_dict(include_code=True), 200

    def toggle_invite(self, invite_id: str, enabled: Optional[bool] = None) -> Tuple[bool, Any, int]:
        """房主启用或禁用指定成员的专属验证码"""
        with self._lock:
            if not self.active_room or self.active_room.status != "open":
                return False, "当前无开放的协作房间", 400

            invite = self.active_room.invites.get(invite_id)
            if not invite:
                return False, "未找到该成员验证码记录", 404

            if enabled is None:
                invite.enabled = not invite.enabled
            else:
                invite.enabled = bool(enabled)

            # 若禁用，即刻使其离线并作废其在线会话
            if not invite.enabled:
                if invite.member_id in self.active_room.members:
                    m = self.active_room.members[invite.member_id]
                    m.online = False
                    m.current_session_id = None
                stale_sids = [sid for sid, s in self.active_room.sessions.items() if s.member_id == invite.member_id]
                for sid in stale_sids:
                    del self.active_room.sessions[sid]

            return True, invite.to_dict(include_code=True), 200

    def delete_invite(self, invite_id: str) -> Tuple[bool, Any, int]:
        """删除指定成员邀请与档案"""
        with self._lock:
            if not self.active_room or self.active_room.status != "open":
                return False, "当前无开放的协作房间", 400

            invite = self.active_room.invites.get(invite_id)
            if not invite:
                return False, "未找到该成员验证码记录", 404

            del self.active_room.invites[invite_id]
            if invite.member_id in self.active_room.members:
                del self.active_room.members[invite.member_id]
            stale_sids = [sid for sid, s in self.active_room.sessions.items() if s.member_id == invite.member_id]
            for sid in stale_sids:
                del self.active_room.sessions[sid]

            return True, {"deleted": invite_id}, 200

    def join_room(
        self,
        room_id: str,
        passcode: Optional[str] = "",
        device_id: str = "",
        device_name: str = "",
        client_name: str = "",
        canvas_data: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, Any, int]:
        with self._lock:
            if not self.active_room or self.active_room.room_id != room_id:
                return False, "房间不存在或未在运行", 404

            if self.active_room.status != "open":
                return False, "房间已关闭", 400

            code_str = str(passcode).strip() if passcode is not None else ""
            now_ms = int(time.time() * 1000)
            now_sec = time.time()

            # 1. 优先在成员专属邀请码中匹配
            matched_invite: Optional[MemberInvite] = None
            if code_str:
                for inv in self.active_room.invites.values():
                    if inv.code == code_str:
                        matched_invite = inv
                        break

            room_passcode = (self.active_room.passcode or "").strip()

            if matched_invite:
                if not matched_invite.enabled:
                    return False, "该验证码已被房主禁用，无法加入", 403

                member_id = matched_invite.member_id
                display_name = matched_invite.display_name
                color = matched_invite.color
                matched_invite.last_used_at = now_ms
                if device_id and not matched_invite.bound_device_id:
                    matched_invite.bound_device_id = device_id
            elif not room_passcode:
                # 房间未设置 PIN 码（免密自由加入）
                member_id = f"mem_{uuid.uuid4().hex[:8]}"
                display_name = client_name.strip() if client_name and client_name.strip() else f"协作者-{member_id[-4:]}"
                color = MEMBER_COLORS[len(self.active_room.members) % len(MEMBER_COLORS)]
            elif code_str and code_str == room_passcode:
                # 匹配全房间通用 PIN 码
                member_id = f"mem_{uuid.uuid4().hex[:8]}"
                display_name = client_name.strip() if client_name and client_name.strip() else f"协作者-{member_id[-4:]}"
                color = MEMBER_COLORS[len(self.active_room.members) % len(MEMBER_COLORS)]
            else:
                if not code_str:
                    return False, "该房间已设置 PIN 码，请输入 PIN 码或专属邀请码后加入", 401
                return False, "PIN 码或专属邀请码错误，请核对后重试", 401

            # 2. 生成本次连接专用会话 sessionId
            session_id = f"sess_{uuid.uuid4().hex[:12]}"
            clean_device_id = device_id.strip() if device_id and device_id.strip() else f"dev_{uuid.uuid4().hex[:8]}"
            clean_device_name = device_name.strip() if device_name and device_name.strip() else "未知设备"

            session = MemberSession(
                session_id=session_id,
                member_id=member_id,
                device_id=clean_device_id,
                device_name=clean_device_name,
                joined_at=now_ms,
                last_seen=now_sec
            )

            # 清理该成员的历史过期 session
            for sid, s in list(self.active_room.sessions.items()):
                if s.member_id == member_id:
                    del self.active_room.sessions[sid]
            self.active_room.sessions[session_id] = session

            # 3. 注册或更新 RoomMember 状态（确保稳定 memberId 和 color）
            if member_id in self.active_room.members:
                member = self.active_room.members[member_id]
                member.display_name = display_name
                member.color = color
                member.device_id = clean_device_id
                member.device_name = clean_device_name
                member.online = True
                member.current_session_id = session_id
                member.last_seen = now_sec
            else:
                member = RoomMember(
                    member_id=member_id,
                    display_name=display_name,
                    color=color,
                    role="member",
                    device_id=clean_device_id,
                    device_name=clean_device_name,
                    online=True,
                    current_session_id=session_id,
                    joined_at=now_ms,
                    last_seen=now_sec
                )
                self.active_room.members[member_id] = member

            # 4. 构建只读画布快照（去除内部敏感字段）
            c_data = canvas_data or {}
            snapshot = {
                "id": c_data.get("id", self.active_room.canvas_id),
                "title": c_data.get("title", self.active_room.canvas_title),
                "nodes": c_data.get("nodes", []),
                "connections": c_data.get("connections", []),
                "viewport": c_data.get("viewport", {"x": 0, "y": 0, "scale": 1}),
                "updatedAt": c_data.get("updated_at", now_ms)
            }

            result_data = {
                "ok": True,
                "memberId": member_id,
                "sessionId": session_id,
                "displayName": display_name,
                "color": color,
                "room": self.active_room.to_public_dict(),
                "snapshot": snapshot,
                "members": self._get_sanitized_members()
            }
            return True, result_data, 200

    def heartbeat(self, room_id: str, member_id: str, session_id: Optional[str] = None) -> Tuple[bool, Any, int]:
        with self._lock:
            if not self.active_room or self.active_room.room_id != room_id:
                return False, "房间不存在", 404

            if self.active_room.status != "open":
                return True, {"status": "closed", "members": []}, 200

            # 必需会话凭据 sessionId 校验：存在、未过期、属于同一 memberId，禁止伪造在线
            if not session_id or not str(session_id).strip():
                return False, "缺少会话凭据 sessionId", 401

            clean_sid = str(session_id).strip()
            session = self.active_room.sessions.get(clean_sid)
            if not session:
                return False, "会话不存在或已失效", 401

            if session.member_id != member_id:
                return False, "会话凭据与成员身份不匹配", 401

            now_sec = time.time()
            if now_sec - session.last_seen > SESSION_TTL_SECONDS:
                return False, "会话已过期", 401

            # 检查专属验证码是否已被房主禁用
            for inv in self.active_room.invites.values():
                if inv.member_id == member_id:
                    if not inv.enabled:
                        return False, "您的专属验证码已被房主禁用", 403
                    break

            session.last_seen = now_sec
            if member_id in self.active_room.members:
                m = self.active_room.members[member_id]
                m.last_seen = now_sec
                m.online = True
                m.current_session_id = clean_sid

            self._prune_stale_members_locked()

            return True, {
                "status": self.active_room.status,
                "members": self._get_sanitized_members()
            }, 200

    def validate_session(self, room_id: str, member_id: str, session_id: str, touch: bool = True) -> Tuple[bool, Optional[Dict[str, Any]], str]:
        """验证协作画布长连接凭据，并可刷新该成员的租约。"""
        with self._lock:
            room = self.active_room
            if not room or room.room_id != str(room_id or "") or room.status != "open":
                return False, None, "房间不存在或已关闭"
            mid = str(member_id or "").strip()
            sid = str(session_id or "").strip()
            session = room.sessions.get(sid) if sid else None
            if not session or session.member_id != mid:
                return False, None, "会话凭据与成员身份不匹配"
            now = time.time()
            if now - session.last_seen > SESSION_TTL_SECONDS:
                return False, None, "会话已过期"
            member = room.members.get(mid)
            if not member:
                return False, None, "成员不存在"
            for inv in room.invites.values():
                if inv.member_id == mid and not inv.enabled:
                    return False, None, "成员验证码已被禁用"
            if touch:
                session.last_seen = now
                member.last_seen = now
                member.online = True
                member.current_session_id = sid
            return True, {
                "roomId": room.room_id,
                "memberId": mid,
                "sessionId": sid,
                "role": member.role,
            }, ""

    def leave_room(self, room_id: str, member_id: str, session_id: Optional[str] = None) -> Tuple[bool, Any, int]:
        with self._lock:
            if not self.active_room or self.active_room.room_id != room_id:
                return False, "房间不存在", 404

            # 必需会话凭据 sessionId 校验：存在、未过期、属于同一 memberId
            if not session_id or not str(session_id).strip():
                return False, "缺少会话凭据 sessionId", 401

            clean_sid = str(session_id).strip()
            session = self.active_room.sessions.get(clean_sid)
            if not session:
                return False, "会话不存在或已失效", 401

            if session.member_id != member_id:
                return False, "会话凭据与成员身份不匹配", 401

            now_sec = time.time()
            if now_sec - session.last_seen > SESSION_TTL_SECONDS:
                return False, "会话已过期", 401

            del self.active_room.sessions[clean_sid]

            if member_id in self.active_room.members:
                m = self.active_room.members[member_id]
                has_other = any(s.member_id == member_id for s in self.active_room.sessions.values())
                if not has_other:
                    is_invited = any(inv.member_id == member_id for inv in self.active_room.invites.values())
                    if is_invited:
                        m.online = False
                        m.current_session_id = None
                    else:
                        if not m.is_host:
                            del self.active_room.members[member_id]
                        else:
                            m.online = False
                            m.current_session_id = None
            return True, {"ok": True}, 200

    def get_snapshot(self, room_id: str, member_id: str, session_id: Optional[str], canvas_data: Dict[str, Any]) -> Tuple[bool, Any, int]:
        with self._lock:
            if not self.active_room or self.active_room.room_id != room_id:
                return False, "房间不存在", 404
            if self.active_room.status != "open":
                return False, "房间已关闭", 400

            # 必需会话凭据 sessionId 校验：存在、未过期、属于同一 memberId，禁止仅凭 memberId 获取快照
            if not session_id or not str(session_id).strip():
                return False, "缺少会话凭据 sessionId", 401

            clean_sid = str(session_id).strip()
            session = self.active_room.sessions.get(clean_sid)
            if not session:
                return False, "会话不存在或已失效", 401

            if session.member_id != member_id:
                return False, "会话凭据与成员身份不匹配", 401

            now_sec = time.time()
            if now_sec - session.last_seen > SESSION_TTL_SECONDS:
                return False, "会话已过期", 401

            for inv in self.active_room.invites.values():
                if inv.member_id == member_id:
                    if not inv.enabled:
                        return False, "您的专属验证码已被房主禁用", 403
                    break

            if member_id not in self.active_room.members:
                return False, "未经验证的成员，无法获取快照", 403

            session.last_seen = now_sec

            c_data = canvas_data or {}
            snapshot = {
                "id": c_data.get("id", self.active_room.canvas_id),
                "title": c_data.get("title", self.active_room.canvas_title),
                "nodes": c_data.get("nodes", []),
                "connections": c_data.get("connections", []),
                "viewport": c_data.get("viewport", {"x": 0, "y": 0, "scale": 1}),
                "updatedAt": c_data.get("updated_at", int(time.time() * 1000))
            }
            return True, {"snapshot": snapshot}, 200

    def _prune_stale_members_locked(self):
        if not self.active_room:
            return
        now = time.time()
        for mid, m in list(self.active_room.members.items()):
            if not m.is_host:
                if now - m.last_seen > 15.0:
                    m.online = False
                    m.current_session_id = None
                    is_invited = any(inv.member_id == mid for inv in self.active_room.invites.values())
                    if not is_invited and (now - m.last_seen > SESSION_TTL_SECONDS):
                        del self.active_room.members[mid]

        dead_sids = [sid for sid, s in self.active_room.sessions.items() if now - s.last_seen > SESSION_TTL_SECONDS]
        for sid in dead_sids:
            del self.active_room.sessions[sid]

    def get_discovered_rooms(self) -> List[Dict[str, Any]]:
        return self.listener.get_rooms()

    def shutdown(self):
        with self._lock:
            self._close_active_room_locked()
        try:
            self.listener.stop()
        except Exception:
            pass

lan_manager = LANManager()
