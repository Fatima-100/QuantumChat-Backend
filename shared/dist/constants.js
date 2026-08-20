"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_FILE_SIZE = exports.ALLOWED_FILE_TYPES = exports.WIDGET_POSITIONS = exports.USER_ROLES = exports.MESSAGE_STATUS = void 0;
exports.MESSAGE_STATUS = {
    SENDING: 'sending',
    SENT: 'sent',
    DELIVERED: 'delivered',
    READ: 'read',
    FAILED: 'failed',
};
exports.USER_ROLES = {
    USER: 'user',
    MODERATOR: 'moderator',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin',
};
exports.WIDGET_POSITIONS = {
    BOTTOM_RIGHT: 'bottom-right',
    BOTTOM_LEFT: 'bottom-left',
    TOP_RIGHT: 'top-right',
    TOP_LEFT: 'top-left',
};
exports.ALLOWED_FILE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
];
exports.MAX_FILE_SIZE = 25 * 1024 * 1024;
