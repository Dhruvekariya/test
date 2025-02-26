from odoo import api, fields, models, _
from odoo.exceptions import UserError
from datetime import datetime
import logging

_logger = logging.getLogger(__name__)

class WhatsAppMessage(models.Model):
    _name = 'whatsapp.message'
    _description = 'WhatsApp Message'
    _order = 'date desc, id desc'

    name = fields.Char(string='Name', compute='_compute_name')
    session_id = fields.Many2one('whatsapp.session', string='Session', required=True)
    message_id = fields.Char(string='Message ID')
    chat_id = fields.Char(string='Chat ID')
    content = fields.Text(string='Content')
    date = fields.Datetime(string='Date', default=fields.Datetime.now)
    direction = fields.Selection([
        ('incoming', 'Incoming'),
        ('outgoing', 'Outgoing')
    ], string='Direction', default='outgoing')
    state = fields.Selection([
        ('pending', 'Pending'),
        ('sent', 'Sent'),
        ('delivered', 'Delivered'),
        ('read', 'Read'),
        ('failed', 'Failed')
    ], string='Status', default='pending')
    
    @api.depends('chat_id', 'date')
    def _compute_name(self):
        for record in self:
            record.name = f"{record.chat_id} - {record.date}"