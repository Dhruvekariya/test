from io import BytesIO
from odoo import api, fields, models, _
from odoo.exceptions import UserError
from datetime import datetime
import logging
import json
import base64
import requests
import tempfile
import os
import qrcode

_logger = logging.getLogger(__name__)


class WhatsAppSession(models.Model):
    _name = "whatsapp.session"
    _description = "WhatsApp Session"
    _rec_name = "user_id"

    user_id = fields.Many2one(
        "res.users", string="User", required=True, default=lambda self: self.env.user
    )
    session_id = fields.Char(string="Session ID")
    qr_code = fields.Binary(string="QR Code")
    qr_code_data = fields.Char(string="QR Code Data")
    state = fields.Selection(
        [
            ("disconnected", "Disconnected"),
            ("connecting", "Connecting"),
            ("connected", "Connected"),
        ],
        string="Status",
        default="disconnected",
    )
    last_connected = fields.Datetime(string="Last Connected")
    name = fields.Char(string="Session Name", required=True)
    state = fields.Selection(
        [
            ("disconnected", "Disconnected"),
            ("connecting", "Connecting"),
            ("connected", "Connected"),
        ],
        default="disconnected",
        string="Status",
    )
    qr_code_image = fields.Binary(string="QR Code")
    user_id = fields.Many2one(
        "res.users", string="User", required=True, default=lambda self: self.env.user
    )
    qr_code_image = fields.Binary(string="QR Code")
    chat = fields.Text(string="Chat")
    chat_list = fields.Text(string="Chat List")
    # New field to store the list of chats (JSON format)
    chat_list_json = fields.Text(string="Chat List JSON")

    def generate_qr_code(self, *args, **kwargs):
        try:
            response = requests.get(
                "http://localhost:3000/get_qr_code"
            )  # Fetch QR Code from Node.js API

            if response.status_code == 200:
                qr_data = response.json().get("qr_data")  # Extract Base64 QR data

                if qr_data:
                    # Remove 'data:image/png;base64,' prefix before decoding
                    qr_base64 = qr_data.split(",")[1]

                    # Convert Base64 to Binary and store in Odoo field
                    self.qr_code_image = qr_base64

                    return {"type": "ir.actions.client", "tag": "reload"}

            raise UserError("Failed to get QR code from the server. Please try again.")
        except Exception as e:
            raise UserError(f"Error generating WhatsApp QR code: {str(e)}")

    # Get Chat List
    def get_chat_list(self, *args, **kwargs):
        try:
            response = requests.get("http://localhost:3000/get-chats")

            if response.status_code == 200:
                chats = response.json().get("chats")

                if chats:
                    chat_names = [chat.get('name') for chat in chats if 'name' in chat]
                    self.chat_list = ", ".join(chat_names)

                    # Convert the list of chats to a string and store in Odoo field

                    # Store the entire chat list as a JSON string in the database
                    self.chat_list_json = json.dumps(chats)

                    return {"type": "ir.actions.client", "tag": "reload"}

            raise UserError("Failed to get chats from the server. Please try again.")

        except Exception as e:
            raise UserError(f"Error getting chat list: {str(e)}")

    def action_connect(self):
        """Initialize WhatsApp connection and generate QR code"""
        self.ensure_one()
        self.state = "connecting"
        # In a real implementation, this would call a server-side service
        # that uses wwebjs to generate a QR code
        return {
            "type": "ir.actions.client",
            "tag": "whatsapp_qr_code",
            "params": {"session_id": self.id},
        }

    def action_disconnect(self):
        """Disconnect from WhatsApp"""
        self.ensure_one()
        self.state = "disconnected"
        self.session_id = False
        return True

    def get_qr_code(self):
        """Generate and get QR code for WhatsApp Web connection"""
        self.ensure_one()

        if not self.session_id:
            # Create a new session ID
            self.session_id = (
                f"session_{self.user_id.id}_{int(datetime.now().timestamp())}"
            )

        try:
            # In a real implementation, this would call a Node.js service that uses whatsapp-web.js
            # For demonstration, we'll use the controller's API
            qr_code_url = f"/whatsapp/qr_code/{self.id}"
            return {"qr_code": self.qr_code, "qr_code_url": qr_code_url}
        except Exception as e:
            _logger.error("Error generating WhatsApp QR code: %s", e)
            raise UserError(_("Failed to generate WhatsApp QR code. Please try again."))

    def check_connection(self):
        """Check WhatsApp connection status"""
        self.ensure_one()

        try:
            # In a real implementation, this would call a Node.js service that uses whatsapp-web.js
            # For demonstration, we'll use the controller's API
            status_url = f"/whatsapp/status/{self.id}"

            # Simulate status check for demonstration
            if self.state == "connecting":
                # Simulate connection after 10 seconds
                last_write = self.write_date
                now = datetime.now()

                if (now - last_write).total_seconds() > 10:
                    self.state = "connected"
                    self.last_connected = now

            return {"state": self.state, "session_id": self.session_id}
        except Exception as e:
            _logger.error("Error checking WhatsApp connection: %s", e)
            return {"state": "disconnected", "error": str(e)}

    def check_active_session(self):
        """Check if user has an active WhatsApp session"""
        self.ensure_one()

        active_session = self.search(
            [("user_id", "=", self.env.user.id), ("state", "=", "connected")], limit=1
        )

        if active_session:
            return {
                "active": True,
                "session_id": active_session.id,
                "state": active_session.state,
            }

        return {"active": False}

    def get_channel(self):
        """Get or create WhatsApp channel for Discuss integration"""

        # Check for active session
        active_session = self.search(
            [("user_id", "=", self.env.user.id), ("state", "=", "connected")], limit=1
        )

        if not active_session:
            return False

        # Create virtual channel ID for WhatsApp
        channel_id = f"whatsapp_{active_session.id}"

        # Get unread message count
        unread_count = self.env["whatsapp.message"].search_count(
            [
                ("session_id", "=", active_session.id),
                ("direction", "=", "incoming"),
                ("state", "not in", ["read"]),
            ]
        )

        return {"channel_id": channel_id, "counter": unread_count}

    def get_chats(self):
        """Get WhatsApp chats"""
        self.ensure_one()

        if self.state != "connected":
            return []

        try:
            # In a real implementation, this would call a Node.js service that uses whatsapp-web.js
            # For demonstration, we'll return sample data
            return [
                {
                    "id": "123456789@c.us",
                    "name": "John Doe",
                    "last_message": "Hello, how are you?",
                    "timestamp": fields.Datetime.now(),
                    "unread": 2,
                },
                {
                    "id": "987654321@c.us",
                    "name": "Jane Smith",
                    "last_message": "Can you send me the document?",
                    "timestamp": fields.Datetime.now(),
                    "unread": 0,
                },
            ]
        except Exception as e:
            _logger.error("Error getting WhatsApp chats: %s", e)
            return []

    def get_chat_messages(self, chat_id, limit=50, before=None):
        """Get messages for a specific chat"""
        self.ensure_one()

        if self.state != "connected":
            return []

        domain = [("session_id", "=", self.id), ("chat_id", "=", chat_id)]

        if before:
            domain.append(("date", "<", before))

        messages = self.env["whatsapp.message"].search(
            domain, order="date desc", limit=limit
        )

        return [
            {
                "id": msg.id,
                "message_id": msg.message_id,
                "content": msg.content,
                "date": msg.date,
                "direction": msg.direction,
                "state": msg.state,
            }
            for msg in messages
        ]

    def send_message(self, chat_id, message):
        """Send WhatsApp message"""
        self.ensure_one()

        if self.state != "connected":
            raise UserError(_("WhatsApp is not connected. Please connect first."))

        try:
            # Create message in database
            msg = self.env["whatsapp.message"].create(
                {
                    "session_id": self.id,
                    "chat_id": chat_id,
                    "content": message,
                    "direction": "outgoing",
                    "state": "pending",
                }
            )

            # In a real implementation, this would call a Node.js service that uses whatsapp-web.js
            # For demonstration, we'll simulate message sending

            # Simulate successful message send
            msg.write(
                {
                    "state": "sent",
                    "message_id": f"msg_{int(datetime.now().timestamp())}",
                }
            )

            return {
                "success": True,
                "message": msg.read(["id", "message_id", "content", "date", "state"])[
                    0
                ],
            }
        except Exception as e:
            _logger.error("Error sending WhatsApp message: %s", e)
            raise UserError(_("Failed to send WhatsApp message: %s") % str(e))

    def mark_messages_read(self, chat_id):
        """Mark all messages in a chat as read"""
        self.ensure_one()

        if self.state != "connected":
            return False

        try:
            # Find all unread incoming messages for this chat
            messages = self.env["whatsapp.message"].search(
                [
                    ("session_id", "=", self.id),
                    ("chat_id", "=", chat_id),
                    ("direction", "=", "incoming"),
                    ("state", "!=", "read"),
                ]
            )

            if messages:
                messages.write({"state": "read"})

            return True
        except Exception as e:
            _logger.error("Error marking WhatsApp messages as read: %s", e)
            return False
