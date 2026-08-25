-- The `better_auth` schema, for the OAuth handshake integration test.
--
-- Dumped from a database migrated by backend/migrations/versions/0003, 0006
-- and 0010, because this suite has no Python and CI's auth job runs a bare
-- Postgres. That leaves the same seam invite.test.js documents: this DDL can
-- drift from the migrations that produce it in production.
--
-- Regenerate after any migration that touches better_auth:
--
--   docker exec mygist-db pg_dump -U mygist -d mygist_local --schema-only \
--     --schema=better_auth --no-owner --no-privileges
--
-- The seam is pinned from the other side by
-- backend/tests/test_better_auth_schema_fixture.py, which asserts the migrated
-- schema still has every table and column this file declares.
CREATE SCHEMA better_auth;
CREATE TABLE better_auth.account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    scope text,
    password text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    issuer text NOT NULL
);
CREATE TABLE better_auth.jwks (
    id text NOT NULL,
    "publicKey" text NOT NULL,
    "privateKey" text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone,
    alg text,
    crv text
);
CREATE TABLE better_auth."oauthAccessToken" (
    id text NOT NULL,
    token text,
    "clientId" text NOT NULL,
    "sessionId" text,
    "userId" text,
    "referenceId" text,
    "refreshId" text,
    "expiresAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    scopes jsonb NOT NULL,
    "authorizationCodeId" text,
    resources jsonb,
    "requestedUserInfoClaims" jsonb,
    revoked timestamp with time zone,
    confirmation jsonb
);
CREATE TABLE better_auth."oauthClient" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "clientSecret" text,
    disabled boolean,
    "skipConsent" boolean,
    "enableEndSession" boolean,
    "subjectType" text,
    scopes jsonb,
    "userId" text,
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone,
    name text,
    uri text,
    icon text,
    contacts jsonb,
    tos text,
    policy text,
    "softwareId" text,
    "softwareVersion" text,
    "softwareStatement" text,
    "redirectUris" jsonb NOT NULL,
    "postLogoutRedirectUris" jsonb,
    "tokenEndpointAuthMethod" text,
    "grantTypes" jsonb,
    "responseTypes" jsonb,
    public boolean,
    type text,
    "requirePKCE" boolean,
    "referenceId" text,
    metadata jsonb,
    "clientDiscoveryId" text,
    "clientCredentialsScopes" jsonb,
    "backchannelLogoutUri" text,
    "backchannelLogoutSessionRequired" boolean,
    "applicationType" text,
    jwks text,
    "jwksUri" text,
    "dpopBoundAccessTokens" boolean
);
CREATE TABLE better_auth."oauthClientAssertion" (
    id text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL
);
CREATE TABLE better_auth."oauthClientResource" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "resourceId" text NOT NULL,
    metadata jsonb,
    "createdAt" timestamp with time zone
);
CREATE TABLE better_auth."oauthConsent" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "userId" text,
    "referenceId" text,
    scopes jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resources jsonb,
    "requestedUserInfoClaims" jsonb
);
CREATE TABLE better_auth."oauthRefreshToken" (
    id text NOT NULL,
    token text NOT NULL,
    "clientId" text NOT NULL,
    "sessionId" text,
    "userId" text NOT NULL,
    "referenceId" text,
    "expiresAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    revoked timestamp with time zone,
    "authTime" timestamp with time zone,
    scopes jsonb NOT NULL,
    "authorizationCodeId" text,
    resources jsonb,
    "requestedUserInfoClaims" jsonb,
    "rotatedAt" timestamp with time zone,
    "rotationReplayResponse" text,
    "rotationReplayExpiresAt" timestamp with time zone,
    confirmation jsonb
);
CREATE TABLE better_auth."oauthResource" (
    id text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    "accessTokenTtl" integer,
    "refreshTokenTtl" integer,
    "signingAlgorithm" text,
    "signingKeyId" text,
    "allowedScopes" jsonb,
    "customClaims" jsonb,
    "dpopBoundAccessTokensRequired" boolean,
    disabled boolean,
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone,
    "policyVersion" integer,
    metadata jsonb
);
CREATE TABLE better_auth.session (
    id text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL
);
CREATE TABLE better_auth."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    image text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    username text,
    "displayUsername" text
);
CREATE TABLE better_auth.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE ONLY better_auth.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);
ALTER TABLE ONLY better_auth.jwks
    ADD CONSTRAINT jwks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY better_auth."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY better_auth."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_token_key" UNIQUE (token);
ALTER TABLE ONLY better_auth."oauthClientAssertion"
    ADD CONSTRAINT "oauthClientAssertion_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY better_auth."oauthClientResource"
    ADD CONSTRAINT "oauthClientResource_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY better_auth."oauthClient"
    ADD CONSTRAINT "oauthClient_clientId_key" UNIQUE ("clientId");
ALTER TABLE ONLY better_auth."oauthClient"
    ADD CONSTRAINT "oauthClient_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY better_auth."oauthConsent"
    ADD CONSTRAINT "oauthConsent_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY better_auth."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY better_auth."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_token_key" UNIQUE (token);
ALTER TABLE ONLY better_auth."oauthResource"
    ADD CONSTRAINT "oauthResource_identifier_key" UNIQUE (identifier);
ALTER TABLE ONLY better_auth."oauthResource"
    ADD CONSTRAINT "oauthResource_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY better_auth.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);
ALTER TABLE ONLY better_auth.session
    ADD CONSTRAINT session_token_key UNIQUE (token);
ALTER TABLE ONLY better_auth."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);
ALTER TABLE ONLY better_auth."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);
ALTER TABLE ONLY better_auth."user"
    ADD CONSTRAINT user_username_key UNIQUE (username);
ALTER TABLE ONLY better_auth.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON better_auth.account USING btree (issuer, "accountId");
CREATE INDEX "account_userId_idx" ON better_auth.account USING btree ("userId");
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON better_auth."oauthAccessToken" USING btree ("authorizationCodeId");
CREATE INDEX "oauthAccessToken_clientId_idx" ON better_auth."oauthAccessToken" USING btree ("clientId");
CREATE INDEX "oauthAccessToken_refreshId_idx" ON better_auth."oauthAccessToken" USING btree ("refreshId");
CREATE INDEX "oauthAccessToken_sessionId_idx" ON better_auth."oauthAccessToken" USING btree ("sessionId");
CREATE INDEX "oauthAccessToken_userId_idx" ON better_auth."oauthAccessToken" USING btree ("userId");
CREATE INDEX "oauthClientResource_clientId_idx" ON better_auth."oauthClientResource" USING btree ("clientId");
CREATE INDEX "oauthClientResource_resourceId_idx" ON better_auth."oauthClientResource" USING btree ("resourceId");
CREATE INDEX "oauthClient_userId_idx" ON better_auth."oauthClient" USING btree ("userId");
CREATE INDEX "oauthConsent_clientId_idx" ON better_auth."oauthConsent" USING btree ("clientId");
CREATE INDEX "oauthConsent_userId_idx" ON better_auth."oauthConsent" USING btree ("userId");
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON better_auth."oauthRefreshToken" USING btree ("authorizationCodeId");
CREATE INDEX "oauthRefreshToken_clientId_idx" ON better_auth."oauthRefreshToken" USING btree ("clientId");
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON better_auth."oauthRefreshToken" USING btree ("sessionId");
CREATE INDEX "oauthRefreshToken_userId_idx" ON better_auth."oauthRefreshToken" USING btree ("userId");
CREATE INDEX "session_userId_idx" ON better_auth.session USING btree ("userId");
CREATE INDEX verification_identifier_idx ON better_auth.verification USING btree (identifier);
ALTER TABLE ONLY better_auth.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY better_auth."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES better_auth."oauthClient"("clientId") ON DELETE CASCADE;
ALTER TABLE ONLY better_auth."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES better_auth."oauthRefreshToken"(id) ON DELETE CASCADE;
ALTER TABLE ONLY better_auth."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES better_auth.session(id) ON DELETE SET NULL;
ALTER TABLE ONLY better_auth."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY better_auth."oauthClientResource"
    ADD CONSTRAINT "oauthClientResource_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES better_auth."oauthClient"("clientId") ON DELETE CASCADE;
ALTER TABLE ONLY better_auth."oauthClientResource"
    ADD CONSTRAINT "oauthClientResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES better_auth."oauthResource"(identifier) ON DELETE CASCADE;
ALTER TABLE ONLY better_auth."oauthClient"
    ADD CONSTRAINT "oauthClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY better_auth."oauthConsent"
    ADD CONSTRAINT "oauthConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES better_auth."oauthClient"("clientId") ON DELETE CASCADE;
ALTER TABLE ONLY better_auth."oauthConsent"
    ADD CONSTRAINT "oauthConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY better_auth."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES better_auth."oauthClient"("clientId") ON DELETE CASCADE;
ALTER TABLE ONLY better_auth."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES better_auth.session(id) ON DELETE SET NULL;
ALTER TABLE ONLY better_auth."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;
ALTER TABLE ONLY better_auth.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;
