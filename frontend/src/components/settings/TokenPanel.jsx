/**
 * API tokens: the list, the create form, and the one look at the secret.
 *
 * Two things were already being returned by db.list_tokens and thrown away:
 * `scopes`, which is the grant, and `expires_at`. A token that quietly stops
 * working is a bad surprise, and a list that does not say what each token can do
 * cannot be audited.
 *
 * The prototype shows a masked secret per row. There is nothing to mask:
 * db.list_tokens returns id, label, created_at, last_used_at, expires_at and
 * scopes, and its docstring says "Never the hash".
 *
 * The scope switches keep write > propose > read true whatever gets clicked.
 * Read has no switch because it is the floor for every token, not a choice.
 */
import { useEffect, useState } from "react";
import { Check, Copy, Key, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { listTokens, createToken, revokeToken } from "@/lib/api.js";
import { READ, PROPOSE, WRITE, summariseScopes } from "@/lib/scopes.js";

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function TokenPanel({ isOpen }) {
  const { toast } = useToast();

  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [newLabel, setNewLabel] = useState("mcp");
  const [generating, setGenerating] = useState(false);
  const [revealed, setRevealed] = useState(null); // { id, label, token }
  const [copied, setCopied] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState(null);
  const [revokingId, setRevokingId] = useState(null);
  // The scope choice for the next minted token. Both start selected, and the
  // handlers below keep write > propose > read true rather than letting a click
  // build a choice that means nothing.
  const [propose, setPropose] = useState(true);
  const [write, setWrite] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setTokens(await listTokens());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) load();
    // load is stable for this purpose: it closes over nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const onWriteChange = (next) => {
    setWrite(next);
    if (next) setPropose(true);
  };

  const onProposeChange = (next) => {
    setPropose(next);
    if (!next) setWrite(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const scopes = [
        READ,
        ...(propose ? [PROPOSE] : []),
        ...(write ? [WRITE] : []),
      ];
      setRevealed(await createToken(newLabel.trim() || "mcp", scopes));
      setCopied(false);
    } catch (err) {
      toast({
        title: "Failed to generate token",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable. The token stays on screen for manual copying.
    }
  };

  const handleDoneReveal = () => {
    setRevealed(null);
    setNewLabel("mcp");
    setPropose(true);
    setWrite(true);
    load();
  };

  const handleRevoke = async (id) => {
    setRevokingId(id);
    try {
      await revokeToken(id);
      setConfirmRevokeId(null);
      toast({ title: "Token revoked", variant: "success" });
      load();
    } catch (err) {
      toast({
        title: "Failed to revoke token",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setRevokingId(null);
    }
  };

  if (revealed) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
          <Check className="h-4 w-4 flex-shrink-0 text-primary" />
          <span>
            Token <strong>{revealed.label}</strong> created.
          </span>
        </div>
        <div className="space-y-2">
          <Label>Token</Label>
          <div className="select-all break-all rounded-lg border bg-muted/50 p-3 font-mono text-sm">
            {revealed.token}
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Copied
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy token
              </>
            )}
          </Button>
        </div>
        <div className="flex gap-2 rounded-lg border p-3 text-xs text-muted-foreground">
          <Key className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            This token won&apos;t be shown again. Save it in a password manager or
            somewhere safe.
          </span>
        </div>
        <Button className="w-full" onClick={handleDoneReveal}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tokens let AI clients (Claude, MCP) access your MyGist.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tokens yet. Generate one below to connect an AI client.
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium">{t.label}</p>
                <p className="text-xs text-muted-foreground">
                  {summariseScopes(t.scopes)}
                </p>
                {/* Not mono. This reads as a sentence, not a scope string. */}
                <p className="text-xs text-muted-foreground">
                  created {formatDate(t.created_at) || "unknown"} &middot; last used{" "}
                  {formatDate(t.last_used_at) || "never"}
                  {formatDate(t.expires_at) && (
                    <> &middot; expires {formatDate(t.expires_at)}</>
                  )}
                </p>
              </div>
              {confirmRevokeId === t.id ? (
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleRevoke(t.id)}
                    disabled={revokingId === t.id}
                  >
                    {revokingId === t.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Revoke"
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmRevokeId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmRevokeId(t.id)}
                  title="Revoke token"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 border-t pt-4">
        <Label htmlFor="new-token-label">Generate token</Label>
        <Input
          id="new-token-label"
          placeholder="mcp"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />

        <div className="space-y-3 rounded-lg border p-3">
          <TokenScopeRow
            id="token-scope-read"
            label="Read your persona"
            help="Always granted -- a token needs this to do anything."
            checked
            disabled
          />
          <TokenScopeRow
            id="token-scope-propose"
            label="Suggest changes for your approval"
            help={
              write
                ? "Included -- direct changes below need this too."
                : "Changes wait for you to approve them before they apply."
            }
            checked={propose}
            onCheckedChange={onProposeChange}
          />
          <TokenScopeRow
            id="token-scope-write"
            label="Change your persona directly"
            help="Applied immediately, without asking first."
            checked={write}
            onCheckedChange={onWriteChange}
          />
        </div>

        <Button onClick={handleGenerate} disabled={generating} className="w-full">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate token"}
        </Button>
      </div>
    </div>
  );
}

// Same shape as Consent.jsx's ScopeRow. The scope choice here is the same
// three-way decision, for a manually minted token instead of an OAuth grant, so
// it reuses that presentation rather than inventing a second one.
function TokenScopeRow({ id, label, help, checked, disabled, onCheckedChange }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5 pr-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange ?? (() => {})}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
