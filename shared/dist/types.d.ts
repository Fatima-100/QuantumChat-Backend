import { MESSAGE_STATUS, USER_ROLES, WIDGET_POSITIONS } from './constants';
export type MessageStatus = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];
export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
export type WidgetPosition = (typeof WIDGET_POSITIONS)[keyof typeof WIDGET_POSITIONS];
export interface WebsiteBranding {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    logoUrl?: string;
    welcomeMessage: string;
    position: WidgetPosition;
    fontFamily?: string;
}
export interface WebsiteSettings {
    allowFileUploads: boolean;
    allowReactions: boolean;
    allowEditing: boolean;
    maxFileSizeMb: number;
    notificationSound: boolean;
}
export interface IUser {
    _id: string;
    websiteId: string;
    externalId?: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
    role: UserRole;
    isBlocked: boolean;
    isOnline: boolean;
    lastSeenAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
export interface IWebsite {
    _id: string;
    tenantId: string;
    name: string;
    domain: string;
    apiKey: string;
    isVerified: boolean;
    isActive: boolean;
    branding: WebsiteBranding;
    settings: WebsiteSettings;
    createdAt: Date;
    updatedAt: Date;
}
export interface IConversation {
    _id: string;
    websiteId: string;
    participants: string[] | IUser[];
    lastMessage?: string | IMessage;
    lastMessageAt?: Date;
    unreadCounts: Record<string, number>;
    createdAt: Date;
    updatedAt: Date;
}
export interface IReaction {
    emoji: string;
    userId: string;
}
export interface IAttachment {
    _id: string;
    websiteId: string;
    uploaderId: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    createdAt: Date;
}
export interface IMessage {
    _id: string;
    websiteId: string;
    conversationId: string;
    senderId: string | IUser;
    content: string;
    replyTo?: string | IMessage;
    attachments: string[] | IAttachment[];
    reactions: IReaction[];
    status: MessageStatus;
    readBy: string[];
    isEdited: boolean;
    isDeleted: boolean;
    deletedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
export interface WidgetThemeConfig {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    logoUrl?: string;
    welcomeMessage?: string;
    position?: WidgetPosition;
    fontFamily?: string;
}
export interface WidgetUserConfig {
    externalId?: string;
    email?: string;
    displayName: string;
    avatarUrl?: string;
}
export interface WidgetConfig {
    websiteId: string;
    apiKey: string;
    apiUrl?: string;
    token?: string;
    brandName?: string;
    user?: WidgetUserConfig;
    theme?: WidgetThemeConfig;
    onReady?: () => void;
    onUnreadCount?: (count: number) => void;
    onMessage?: (message: IMessage) => void;
}
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}
export interface PaginatedResponse<T> {
    data: T[];
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
}
