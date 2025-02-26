# -*- coding: utf-8 -*-
{
    'name': 'WhatsApp Integration',
    'version': '1.0',
    'category': 'Discuss',
    'summary': 'Integrate WhatsApp Web with Odoo Discuss',
    'description': """
        This module integrates WhatsApp Web into Odoo Discuss module.
        It allows users to connect to WhatsApp Web using QR code and send/receive messages.
    """,
    'author': 'Your Company',
    'website': 'https://www.yourcompany.com',
    'depends': ['mail', 'web'],
    'data': [
        'security/ir.model.access.csv',
        'views/whatsapp_views.xml',
    ],
    'qweb': [
        'static/src/xml/whatsapp_chat.xml',
    ],
    'assets': {
        'web.assets_backend': [
            #'whatsapp_integration/static/src/js/whatsapp_chat.js',
            'whatsapp_integration/static/src/scss/whatsapp_chat.scss',
        ],
    },
    'installable': True,
    'application': True,
    'auto_install': False,
}