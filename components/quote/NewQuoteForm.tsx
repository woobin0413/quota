"use client";

/**
 * New Quote Form — Catalog-based Quote Builder
 *
 * Flow:
 *   1. Pick a client (existing) or enter a new one
 *   2. Add work items from the catalog (searchable), or ad-hoc lines
 *   3. Adjust quantities/prices, review totals
 *   4. Save draft → redirected to the quote page to send
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Search } from "lucide-react";
import { CatalogPicker } from "./CatalogPicker";
import { UpgradeDialog } from "@/components/subscription/UpgradeDialog";
import { useSubscription } from "@/components/subscription/use-subscription";
import { formatCurrency } from "@/lib/quote-calculations";
import {
  nextAvailableTier,
  QUOTA_RESET_NOTE,
  TIER_LABEL,
  quoteLimitLabel,
  type Tier,
} from "@/lib/subscription";
import type { Contact, WorkItem } from "@/types/database";

interface BuilderLine {
  key: string; // local list key
  workItemId?: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

let lineCounter = 0;
function nextKey(): string {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

export function NewQuoteForm() {
  const router = useRouter();
  const { sub } = useSubscription();

  // Clients
  const [clients, setClients] = useState<Contact[]>([]);
  const [clientMode, setClientMode] = useState<"existing" | "new">("new");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientAddress, setNewClientAddress] = useState("");
  const [newClientCity, setNewClientCity] = useState("");
  const [newClientState, setNewClientState] = useState("");
  const [newClientZip, setNewClientZip] = useState("");

  // Project
  const [projectName, setProjectName] = useState("");

  // Lines
  const [lines, setLines] = useState<BuilderLine[]>([]);

  // Submission
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<{ tier: Tier; reason: string } | null>(
    null
  );

  // The client list loads async; once the user has touched the client
  // section, its arrival must not flip the mode and hide their input
  const clientTouched = useRef(false);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setClients(data.clients);
          if (data.clients.length > 0 && !clientTouched.current) {
            setClientMode("existing");
          }
        } else {
          setClientsError(
            "Couldn't load your client list. You can still enter a new client below."
          );
        }
      })
      .catch(() => {
        // Surfaced rather than swallowed: new-client entry still works, but
        // the contractor needs to know the existing-client list is missing
        // rather than assuming they have no clients.
        setClientsError(
          "Couldn't load your client list. You can still enter a new client below."
        );
      });
  }, []);

  const addFromCatalog = useCallback((item: WorkItem) => {
    setLines((prev) => [
      ...prev,
      {
        key: nextKey(),
        workItemId: item.id,
        description: item.name,
        quantity: 1,
        unit: item.unit_of_measure,
        unitPrice: item.defaultUnitPrice,
      },
    ]);
  }, []);

  const addAdHocLine = () => {
    setLines((prev) => [
      ...prev,
      {
        key: nextKey(),
        description: "",
        quantity: 1,
        unit: "each",
        unitPrice: 0,
      },
    ]);
  };

  const updateLine = (key: string, updates: Partial<BuilderLine>) => {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...updates } : line))
    );
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((line) => line.key !== key));
  };

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [lines]
  );
  const total = subtotal;

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const clientName =
    clientMode === "existing" ? (selectedClient?.name ?? "") : newClientName;
  const clientEmail =
    clientMode === "existing" ? (selectedClient?.email ?? "") : newClientEmail;

  const canSave =
    clientName.trim().length > 0 &&
    lines.length > 0 &&
    lines.every((l) => l.description.trim() && l.quantity > 0);

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientMode === "existing" ? selectedClientId : undefined,
          clientInfo: {
            name: clientName.trim(),
            email: clientEmail || "",
            ...(clientMode === "new" && {
              address: newClientAddress.trim() || "",
              city: newClientCity.trim() || "",
              state: newClientState.trim() || "",
              zipCode: newClientZip.trim() || "",
            }),
          },
          projectName: projectName.trim() || undefined,
          lineItems: lines.map((line) => ({
            description: line.description.trim(),
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            unit: line.unit,
            workItemId: line.workItemId,
          })),
        }),
      });

      const data = await response.json();

      if (response.status === 403 && data.code === "QUOTE_LIMIT") {
        // Only send them to the upgrade dialog when there's a plan to buy;
        // otherwise the dialog would offer nothing but a "coming soon" card.
        if (nextAvailableTier(data.tier as Tier)) {
          setUpgrade({
            tier: data.tier,
            reason: `${data.message} Upgrade to keep quoting.`,
          });
        } else {
          setError(`${data.message} ${QUOTA_RESET_NOTE}`);
        }
        setIsSaving(false);
        return;
      }

      if (data.success) {
        router.push(`/quote/${data.quoteNumber ?? data.id}`);
      } else {
        setError(data.message || "Failed to save quote");
        setIsSaving(false);
      }
    } catch {
      setError("Failed to save quote");
      setIsSaving(false);
    }
  };

  // Null when nothing above the current plan is purchasable — the banner then
  // points at the monthly reset instead of an upgrade we can't sell.
  const upgradeTier = sub ? nextAvailableTier(sub.tier) : null;

  return (
    <div
      className="grid gap-6 lg:grid-cols-[1fr_360px]"
      data-testid="quote-builder"
    >
      {sub && sub.quotesRemaining !== null && sub.quotesRemaining <= 1 && (
        <div
          className="mb-4 flex items-center justify-between border border-accent bg-accent/10 px-4 py-3 lg:col-span-2"
          data-testid="quota-banner"
        >
          <p className="text-sm">
            {sub.quotesRemaining === 1 ? (
              <>
                Last quote on your {sub.tierLabel} plan
                {upgradeTier && (
                  <>
                    {" "}
                    — {TIER_LABEL[upgradeTier]} gives you{" "}
                    {quoteLimitLabel(upgradeTier).toLowerCase() === "unlimited"
                      ? "unlimited quotes"
                      : `${quoteLimitLabel(upgradeTier)} quotes`}
                  </>
                )}
                .
              </>
            ) : (
              <>
                You&apos;ve used all {sub.quoteLimit} quotes this month on{" "}
                {sub.tierLabel}.
              </>
            )}
            {!upgradeTier && <> {QUOTA_RESET_NOTE}</>}
          </p>
          {upgradeTier && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setUpgrade({
                  tier: sub.tier,
                  reason:
                    sub.quotesRemaining === 0
                      ? `You've used all ${sub.quoteLimit} quotes this month on your ${sub.tierLabel} plan.`
                      : `Last quote on your ${sub.tierLabel} plan — upgrade to keep quoting.`,
                })
              }
            >
              Upgrade
            </Button>
          )}
        </div>
      )}
      <div className="min-w-0 space-y-6">
        {/* Client */}
        <Card>
          <CardHeader>
            <CardTitle>Client</CardTitle>
            <CardDescription>Who is this quote for?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {clientsError && (
              <p className="text-sm text-destructive" role="alert">
                {clientsError}
              </p>
            )}
            {clients.length > 0 && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={clientMode === "existing" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    clientTouched.current = true;
                    setClientMode("existing");
                  }}
                  data-testid="client-mode-existing"
                >
                  Existing client
                </Button>
                <Button
                  type="button"
                  variant={clientMode === "new" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    clientTouched.current = true;
                    setClientMode("new");
                  }}
                  data-testid="client-mode-new"
                >
                  New client
                </Button>
              </div>
            )}

            {clientMode === "existing" && clients.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="client-select">Client</Label>
                <Select
                  value={selectedClientId}
                  onValueChange={setSelectedClientId}
                >
                  <SelectTrigger id="client-select" data-testid="client-select">
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                        {client.company ? ` — ${client.company}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="client-name">Name</Label>
                  <Input
                    id="client-name"
                    value={newClientName}
                    onChange={(e) => {
                      clientTouched.current = true;
                      setNewClientName(e.target.value);
                    }}
                    placeholder="e.g. John Smith"
                    maxLength={200}
                    data-testid="client-name-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="client-email">Email</Label>
                  <Input
                    id="client-email"
                    type="email"
                    value={newClientEmail}
                    onChange={(e) => {
                      clientTouched.current = true;
                      setNewClientEmail(e.target.value);
                    }}
                    placeholder="client@example.com"
                    maxLength={254}
                    data-testid="client-email-input"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="client-address">
                    Street address (optional)
                  </Label>
                  <Input
                    id="client-address"
                    value={newClientAddress}
                    onChange={(e) => {
                      clientTouched.current = true;
                      setNewClientAddress(e.target.value);
                    }}
                    placeholder="123 Main St"
                    maxLength={500}
                    data-testid="client-address-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="client-city">City</Label>
                  <Input
                    id="client-city"
                    value={newClientCity}
                    onChange={(e) => {
                      clientTouched.current = true;
                      setNewClientCity(e.target.value);
                    }}
                    placeholder="e.g. Austin"
                    maxLength={120}
                    data-testid="client-city-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="client-state">State</Label>
                  <Input
                    id="client-state"
                    value={newClientState}
                    onChange={(e) => {
                      clientTouched.current = true;
                      setNewClientState(e.target.value);
                    }}
                    placeholder="e.g. TX"
                    maxLength={60}
                    data-testid="client-state-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="client-zip">ZIP (optional)</Label>
                  <Input
                    id="client-zip"
                    value={newClientZip}
                    onChange={(e) => {
                      clientTouched.current = true;
                      setNewClientZip(e.target.value);
                    }}
                    placeholder="78701"
                    maxLength={20}
                    data-testid="client-zip-input"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="project-name">Project name (optional)</Label>
              <Input
                id="project-name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Kitchen remodel"
                data-testid="project-name-input"
              />
            </div>
          </CardContent>
        </Card>

        {/* Line items */}
        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Work</CardTitle>
              <CardDescription>
                Selected work for this quote. Adjust quantity and price per
                line.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addAdHocLine}
              data-testid="add-adhoc-line-button"
            >
              <Plus className="mr-2 h-4 w-4" />
              Ad-hoc line
            </Button>
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Search className="mx-auto mb-2 h-6 w-6" />
                Add work from your catalog on the right, or an ad-hoc line.
              </div>
            ) : (
              <div className="space-y-3" data-testid="builder-lines">
                {lines.map((line) => (
                  <div
                    key={line.key}
                    className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-md border p-3 sm:grid-cols-[2fr_100px_90px_120px_110px_auto]"
                    data-testid="builder-line"
                  >
                    <div className="space-y-1">
                      <Label className="text-xs">Description</Label>
                      <Input
                        value={line.description}
                        onChange={(e) =>
                          updateLine(line.key, { description: e.target.value })
                        }
                        placeholder="Describe the work"
                        data-testid="line-description-input"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(line.key, {
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                        data-testid="line-quantity-input"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Unit</Label>
                      <Input
                        value={line.unit}
                        onChange={(e) =>
                          updateLine(line.key, { unit: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Unit price</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) =>
                          updateLine(line.key, {
                            unitPrice: parseFloat(e.target.value) || 0,
                          })
                        }
                        data-testid="line-price-input"
                      />
                    </div>
                    <div className="space-y-1 text-right">
                      <Label className="text-xs">Total</Label>
                      <p
                        className="figure py-2 font-medium"
                        data-testid="line-total"
                      >
                        {formatCurrency(line.quantity * line.unitPrice)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeLine(line.key)}
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Separator className="my-4" />

            {/* Totals */}
            <div className="ml-auto max-w-xs space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="figure" data-testid="subtotal">
                  {formatCurrency(subtotal)}
                </span>
              </div>
              <div className="flex justify-between border-t-2 border-primary pt-2 font-semibold">
                <span className="font-display uppercase tracking-wide">
                  Total
                </span>
                <span className="figure" data-testid="quote-total">
                  {formatCurrency(total)}
                </span>
              </div>
            </div>

            {error && (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end">
              <Button
                onClick={handleSave}
                disabled={!canSave || isSaving}
                data-testid="save-quote-button"
              >
                {isSaving ? "Saving..." : "Save quote"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Catalog picker sidebar */}
      <div className="min-w-0">
        <CatalogPicker onAdd={addFromCatalog} />
      </div>

      {upgrade && (
        <UpgradeDialog
          open={true}
          onOpenChange={(o) => !o && setUpgrade(null)}
          currentTier={upgrade.tier}
          reason={upgrade.reason}
          cancelAtPeriodEnd={sub?.cancelAtPeriodEnd}
          currentPeriodEnd={sub?.currentPeriodEnd}
        />
      )}
    </div>
  );
}
