odoo.define('whatsapp_integration.chat', [
    'web.core',
    'web.Widget',
    'mail.model',
    'mail.Discuss',
    'mail.DocumentViewer',
    'mail.widget.ThreadWindow'
], function (require) {
    'use strict';
    
    const core = require('web.core');
    const Widget = require('web.Widget');
    const DiscussChannel = require('mail.model');
    const ChatWindow = require('mail.widget.ThreadWindow');
    const Discuss = require('mail.Discuss');
    const DocumentViewer = require('mail.DocumentViewer');
    const QWeb = core.qweb;
    const _t = core._t;
    
    // Add a new channel type for WhatsApp
    DiscussChannel.include({
        init: function (parent, data) {
            this._super.apply(this, arguments);
            this.whatsapp_channel = data.whatsapp_channel || false;
        },
    });

    // WhatsApp QR Code Client Action
    const WhatsAppQRCode = Widget.extend({
        template: 'whatsapp_integration.QRCodeScreen',
        events: {
            'click .o_whatsapp_cancel': '_onCancelClick',
        },

        init: function (parent, options) {
            this._super.apply(this, arguments);
            this.sessionId = options.params.session_id;
            this.state = 'connecting';
            this.qrCodeData = null;
            this.checkInterval = null;
        },

        willStart: function () {
            return Promise.all([
                this._super.apply(this, arguments),
                this._fetchQRCode(),
            ]);
        },

        start: function () {
            const result = this._super.apply(this, arguments);
            this.checkInterval = setInterval(() => this._checkConnection(), 3000);
            return result;
        },

        destroy: function () {
            if (this.checkInterval) {
                clearInterval(this.checkInterval);
            }
            this._super.apply(this, arguments);
        },

        _fetchQRCode: function () {
            return this._rpc({
                model: 'whatsapp.session',
                method: 'get_qr_code',
                args: [this.sessionId],
            }).then(result => {
                if (result && result.qr_code) {
                    this.qrCodeData = 'data:image/png;base64,' + result.qr_code;
                }
            });
        },

        _checkConnection: function () {
            return this._rpc({
                model: 'whatsapp.session',
                method: 'check_connection',
                args: [this.sessionId],
            }).then(result => {
                if (result && result.state) {
                    this.state = result.state;
                    if (this.state === 'connected') {
                        this._onConnectionSuccess();
                    } else if (this.state === 'disconnected') {
                        this._onConnectionFailure();
                    }
                }
            });
        },

        _onConnectionSuccess: function () {
            clearInterval(this.checkInterval);
            this.do_notify(_t('WhatsApp Connected'), _t('Successfully connected to WhatsApp!'));
            this.destroy_action();
            core.bus.trigger('whatsapp_connected', { session_id: this.sessionId });
        },

        _onConnectionFailure: function () {
            clearInterval(this.checkInterval);
            this.do_warn(_t('Connection Failed'), _t('Failed to connect to WhatsApp. Please try again.'));
            this.destroy_action();
        },

        _onCancelClick: function () {
            this.destroy_action();
        },
    });

    core.action_registry.add('whatsapp_qr_code', WhatsAppQRCode);
    
    return {
        WhatsAppQRCode: WhatsAppQRCode,
    };
});
