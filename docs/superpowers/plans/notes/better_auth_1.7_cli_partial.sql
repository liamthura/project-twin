alter table "jwks" add column "alg" text;

alter table "jwks" add column "crv" text;

alter table "oauthClient" add column "clientDiscoveryId" text;

alter table "oauthClient" add column "clientCredentialsScopes" jsonb;

alter table "oauthClient" add column "backchannelLogoutUri" text;

alter table "oauthClient" add column "backchannelLogoutSessionRequired" boolean;

alter table "oauthClient" add column "applicationType" text;

alter table "oauthClient" add column "jwks" text;

alter table "oauthClient" add column "jwksUri" text;

alter table "oauthClient" add column "dpopBoundAccessTokens" boolean;

alter table "oauthRefreshToken" add index "oauthRefreshToken_authorizationCodeId_idx";

alter table "oauthRefreshToken" add column "authorizationCodeId" text;

alter table "oauthRefreshToken" add column "resources" jsonb;

alter table "oauthRefreshToken" add column "requestedUserInfoClaims" jsonb;

alter table "oauthRefreshToken" add column "rotatedAt" timestamptz;

alter table "oauthRefreshToken" add column "rotationReplayResponse" text;

alter table "oauthRefreshToken" add column "rotationReplayExpiresAt" timestamptz;

alter table "oauthRefreshToken" add column "confirmation" jsonb;

alter table "oauthAccessToken" add index "oauthAccessToken_authorizationCodeId_idx";

alter table "oauthAccessToken" add column "authorizationCodeId" text;

alter table "oauthAccessToken" add column "resources" jsonb;

alter table "oauthAccessToken" add column "requestedUserInfoClaims" jsonb;

alter table "oauthAccessToken" add column "revoked" timestamptz;

alter table "oauthAccessToken" add column "confirmation" jsonb;

alter table "oauthConsent" add column "resources" jsonb;

alter table "oauthConsent" add column "requestedUserInfoClaims" jsonb;

create table "oauthResource" ("id" text not null primary key, "identifier" text not null unique, "name" text not null, "accessTokenTtl" integer, "refreshTokenTtl" integer, "signingAlgorithm" text, "signingKeyId" text, "allowedScopes" jsonb, "customClaims" jsonb, "dpopBoundAccessTokensRequired" boolean, "disabled" boolean, "createdAt" timestamptz, "updatedAt" timestamptz, "policyVersion" integer, "metadata" jsonb);

create table "oauthClientResource" ("id" text not null primary key, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "resourceId" text not null references "oauthResource" ("identifier") on delete cascade, "metadata" jsonb, "createdAt" timestamptz);

create table "oauthClientAssertion" ("id" text not null primary key, "expiresAt" timestamptz not null);

create index "oauthClientResource_clientId_idx" on "oauthClientResource" ("clientId");

create index "oauthClientResource_resourceId_idx" on "oauthClientResource" ("resourceId");