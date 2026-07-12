-- ============================================================
-- Harmony v3 — Company DB Core Tables
-- Ejecutado automáticamente al provisionar harmony_c{id}
-- ============================================================

-- Departamentos
CREATE TABLE IF NOT EXISTS departments (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    color VARCHAR(10) DEFAULT '#6366f1',
    is_active BOOLEAN DEFAULT true,
    auto_assign BOOLEAN DEFAULT false,
    max_conversations_per_agent INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_departments_company_id ON departments(company_id);

-- Usuarios de empresa
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT,
    department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'agent' CHECK (role IN ('superadmin','admin','supervisor','agent','mercadeo')),
    avatar_path TEXT,
    is_online BOOLEAN DEFAULT false,
    last_seen_at TIMESTAMPTZ,
    can_send_campaigns BOOLEAN DEFAULT false,
    can_access_advertising BOOLEAN DEFAULT false,
    is_bot BOOLEAN DEFAULT false,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);

-- Canales de comunicación
CREATE TABLE IF NOT EXISTS channels (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('whatsapp','messenger','instagram','telegram')),
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    identifier VARCHAR(255) DEFAULT '',
    credentials JSONB DEFAULT '{}',
    webhook_secret VARCHAR(255) DEFAULT '',
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_channels_company_id ON channels(company_id);
CREATE INDEX IF NOT EXISTS idx_channels_type ON channels(type);

-- Contactos
CREATE TABLE IF NOT EXISTS contacts (
    id BIGSERIAL PRIMARY KEY,
    channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    external_id VARCHAR(255) DEFAULT '',
    name VARCHAR(255) DEFAULT '',
    phone VARCHAR(50) DEFAULT '',
    email VARCHAR(255) DEFAULT '',
    avatar_url TEXT DEFAULT '',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contacts_channel_id ON contacts(channel_id);
CREATE INDEX IF NOT EXISTS idx_contacts_external_id ON contacts(external_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

-- Conversaciones
CREATE TABLE IF NOT EXISTS conversations (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    agent_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    case_number VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('open','pending','closed')),
    last_message_at TIMESTAMPTZ,
    unread_count INT DEFAULT 0,
    window_expires_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_conversations_company_id ON conversations(company_id);
CREATE INDEX IF NOT EXISTS idx_conversations_channel_id ON conversations(channel_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_case_number ON conversations(case_number);
CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at ON conversations(deleted_at);

-- Mensajes
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    body TEXT DEFAULT '',
    type VARCHAR(50) DEFAULT 'text' CHECK (type IN ('text','image','video','audio','document','sticker','location','template','reaction','system')),
    direction VARCHAR(20) NOT NULL CHECK (direction IN ('inbound','outbound')),
    status VARCHAR(50) DEFAULT 'sent' CHECK (status IN ('pending','sent','delivered','read','failed')),
    external_id VARCHAR(255) DEFAULT '',
    channel_message_id VARCHAR(255) DEFAULT '',
    error_message TEXT DEFAULT '',
    meta JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_id);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Adjuntos de mensajes
CREATE TABLE IF NOT EXISTS message_attachments (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    azure_path TEXT NOT NULL DEFAULT '',
    original_name VARCHAR(255) DEFAULT '',
    mime_type VARCHAR(100) DEFAULT '',
    size BIGINT DEFAULT 0,
    thumbnail_path TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);

-- Etiquetas
CREATE TABLE IF NOT EXISTS tags (
    id BIGSERIAL PRIMARY KEY,
    department_id BIGINT REFERENCES departments(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(10) DEFAULT '#6366f1',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relación conversaciones-etiquetas
CREATE TABLE IF NOT EXISTS conversation_tags (
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, tag_id)
);

-- Historial de asignaciones de conversaciones
CREATE TABLE IF NOT EXISTS conversation_agents (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    agent_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    unassigned_at TIMESTAMPTZ,
    assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_conversation_agents_conversation_id ON conversation_agents(conversation_id);

-- Templates de mensajes (WhatsApp HSM y respuestas rápidas)
CREATE TABLE IF NOT EXISTS message_templates (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    channel_type VARCHAR(50) DEFAULT 'whatsapp',
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) DEFAULT 'UTILITY',
    language VARCHAR(10) DEFAULT 'es',
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paused')),
    body TEXT NOT NULL,
    header_type VARCHAR(50) DEFAULT 'none',
    header_content TEXT DEFAULT '',
    footer TEXT DEFAULT '',
    buttons JSONB DEFAULT '[]',
    variables JSONB DEFAULT '[]',
    external_template_id VARCHAR(255) DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_message_templates_company_id ON message_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_status ON message_templates(status);

-- Campañas de mensajería masiva
CREATE TABLE IF NOT EXISTS campaigns (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    channel_id BIGINT REFERENCES channels(id) ON DELETE SET NULL,
    template_id BIGINT REFERENCES message_templates(id) ON DELETE SET NULL,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','completed','cancelled','failed')),
    type VARCHAR(50) DEFAULT 'broadcast' CHECK (type IN ('broadcast','drip','triggered')),
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    total_recipients INT DEFAULT 0,
    sent_count INT DEFAULT 0,
    delivered_count INT DEFAULT 0,
    read_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    variables_map JSONB DEFAULT '{}',
    filters JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_campaigns_company_id ON campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- Destinatarios de campañas
CREATE TABLE IF NOT EXISTS campaign_recipients (
    id BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
    phone VARCHAR(50) NOT NULL,
    name VARCHAR(255) DEFAULT '',
    variables JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','read','failed','opted_out')),
    message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    error_message TEXT DEFAULT '',
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_id ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status ON campaign_recipients(status);

-- Configuración del bot IA por empresa/departamento
CREATE TABLE IF NOT EXISTS bot_configs (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
    channel_id BIGINT REFERENCES channels(id) ON DELETE SET NULL,
    is_enabled BOOLEAN DEFAULT false,
    model VARCHAR(100) DEFAULT 'claude-sonnet-4-5',
    system_prompt TEXT DEFAULT '',
    temperature FLOAT DEFAULT 0.7,
    max_tokens INT DEFAULT 1024,
    transfer_to_human_keywords JSONB DEFAULT '[]',
    transfer_to_agent_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    greeting_message TEXT DEFAULT '',
    fallback_message TEXT DEFAULT '',
    business_hours_only BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bot_configs_company_id ON bot_configs(company_id);

-- Documentos de conocimiento del bot (RAG)
CREATE TABLE IF NOT EXISTS bot_documents (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    bot_config_id BIGINT REFERENCES bot_configs(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    azure_path TEXT NOT NULL,
    mime_type VARCHAR(100) DEFAULT '',
    size BIGINT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'processing' CHECK (status IN ('processing','ready','failed')),
    chunk_count INT DEFAULT 0,
    error_message TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bot_documents_company_id ON bot_documents(company_id);

-- Precios de mensajes WhatsApp por país/categoría
CREATE TABLE IF NOT EXISTS whatsapp_pricing (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    channel_id BIGINT REFERENCES channels(id) ON DELETE CASCADE,
    country_code VARCHAR(5) NOT NULL,
    country_name VARCHAR(100) DEFAULT '',
    category VARCHAR(100) NOT NULL CHECK (category IN ('utility','marketing','authentication','service')),
    price_usd NUMERIC(10,6) DEFAULT 0,
    effective_from TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_pricing_company_id ON whatsapp_pricing(company_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_pricing_country ON whatsapp_pricing(country_code);

-- Eventos de webhook (para procesamiento asíncrono y auditoría)
CREATE TABLE IF NOT EXISTS webhook_events (
    id BIGSERIAL PRIMARY KEY,
    channel_id BIGINT REFERENCES channels(id) ON DELETE SET NULL,
    channel_type VARCHAR(50) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMPTZ,
    error_message TEXT DEFAULT '',
    attempts INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_channel_id ON webhook_events(channel_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at);

-- Log de auditoría
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id BIGINT,
    old_values JSONB DEFAULT '{}',
    new_values JSONB DEFAULT '{}',
    ip_address VARCHAR(45) DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id ON audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- ============================================================
-- Módulo Publicidad / Social Media (pub_*)
-- ============================================================

-- Cuentas de redes sociales para publicidad
CREATE TABLE IF NOT EXISTS pub_social_accounts (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    platform VARCHAR(50) NOT NULL CHECK (platform IN ('facebook','instagram','tiktok','google_ads','twitter')),
    name VARCHAR(255) NOT NULL,
    account_id VARCHAR(255) NOT NULL,
    access_token TEXT DEFAULT '',
    refresh_token TEXT DEFAULT '',
    token_expires_at TIMESTAMPTZ,
    ad_account_id VARCHAR(255) DEFAULT '',
    page_id VARCHAR(255) DEFAULT '',
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','inactive','expired')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pub_social_accounts_company_id ON pub_social_accounts(company_id);

-- Configuración de publicidad por empresa
CREATE TABLE IF NOT EXISTS pub_settings (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT UNIQUE NOT NULL,
    default_currency VARCHAR(10) DEFAULT 'USD',
    monthly_budget_limit NUMERIC(12,2) DEFAULT 0,
    auto_approve_threshold NUMERIC(12,2) DEFAULT 0,
    notification_emails JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Posts / contenido orgánico programado
CREATE TABLE IF NOT EXISTS pub_posts (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    social_account_id BIGINT REFERENCES pub_social_accounts(id) ON DELETE SET NULL,
    title VARCHAR(255) DEFAULT '',
    body TEXT DEFAULT '',
    media_paths JSONB DEFAULT '[]',
    platforms JSONB DEFAULT '[]',
    hashtags JSONB DEFAULT '[]',
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','scheduled','published','rejected','failed')),
    scheduled_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    external_post_ids JSONB DEFAULT '{}',
    rejection_reason TEXT DEFAULT '',
    metrics JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pub_posts_company_id ON pub_posts(company_id);
CREATE INDEX IF NOT EXISTS idx_pub_posts_status ON pub_posts(status);
CREATE INDEX IF NOT EXISTS idx_pub_posts_scheduled_at ON pub_posts(scheduled_at);

-- Campañas de publicidad pagada
CREATE TABLE IF NOT EXISTS pub_campaigns (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    social_account_id BIGINT REFERENCES pub_social_accounts(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    objective VARCHAR(100) DEFAULT 'traffic',
    platform VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','active','paused','completed','rejected','failed')),
    budget_type VARCHAR(50) DEFAULT 'daily' CHECK (budget_type IN ('daily','lifetime')),
    budget_amount NUMERIC(12,2) DEFAULT 0,
    spent_amount NUMERIC(12,2) DEFAULT 0,
    start_date DATE,
    end_date DATE,
    targeting JSONB DEFAULT '{}',
    ad_creatives JSONB DEFAULT '[]',
    external_campaign_id VARCHAR(255) DEFAULT '',
    rejection_reason TEXT DEFAULT '',
    metrics JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pub_campaigns_company_id ON pub_campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_pub_campaigns_status ON pub_campaigns(status);

-- Flujo de aprobaciones para posts y campañas
CREATE TABLE IF NOT EXISTS pub_approvals (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    resource_type VARCHAR(50) NOT NULL CHECK (resource_type IN ('post','campaign')),
    resource_id BIGINT NOT NULL,
    requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
    notes TEXT DEFAULT '',
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pub_approvals_resource ON pub_approvals(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_pub_approvals_status ON pub_approvals(status);

-- Comentarios y feedback en posts/campañas
CREATE TABLE IF NOT EXISTS pub_comments (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    resource_type VARCHAR(50) NOT NULL CHECK (resource_type IN ('post','campaign','approval')),
    resource_id BIGINT NOT NULL,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pub_comments_resource ON pub_comments(resource_type, resource_id);

-- Analytics diarios de publicidad
CREATE TABLE IF NOT EXISTS pub_analytics (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    resource_type VARCHAR(50) NOT NULL CHECK (resource_type IN ('post','campaign','account')),
    resource_id BIGINT NOT NULL,
    date DATE NOT NULL,
    impressions BIGINT DEFAULT 0,
    reach BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    conversions BIGINT DEFAULT 0,
    spend NUMERIC(12,2) DEFAULT 0,
    cpm NUMERIC(10,4) DEFAULT 0,
    cpc NUMERIC(10,4) DEFAULT 0,
    ctr NUMERIC(8,4) DEFAULT 0,
    roas NUMERIC(10,4) DEFAULT 0,
    likes BIGINT DEFAULT 0,
    comments BIGINT DEFAULT 0,
    shares BIGINT DEFAULT 0,
    saves BIGINT DEFAULT 0,
    video_views BIGINT DEFAULT 0,
    extra JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pub_analytics_unique ON pub_analytics(resource_type, resource_id, date);
CREATE INDEX IF NOT EXISTS idx_pub_analytics_company_date ON pub_analytics(company_id, date);

-- Leads captados vía publicidad
CREATE TABLE IF NOT EXISTS pub_leads (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    campaign_id BIGINT REFERENCES pub_campaigns(id) ON DELETE SET NULL,
    contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
    conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
    name VARCHAR(255) DEFAULT '',
    phone VARCHAR(50) DEFAULT '',
    email VARCHAR(255) DEFAULT '',
    platform VARCHAR(50) DEFAULT '',
    external_lead_id VARCHAR(255) DEFAULT '',
    form_data JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','converted','disqualified')),
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pub_leads_company_id ON pub_leads(company_id);
CREATE INDEX IF NOT EXISTS idx_pub_leads_campaign_id ON pub_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_pub_leads_status ON pub_leads(status);

-- Agentes virtuales / bots especializados por canal
CREATE TABLE IF NOT EXISTS pub_agents (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    platform VARCHAR(50) NOT NULL,
    social_account_id BIGINT REFERENCES pub_social_accounts(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    auto_reply BOOLEAN DEFAULT false,
    reply_templates JSONB DEFAULT '[]',
    keywords JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pub_agents_company_id ON pub_agents(company_id);
