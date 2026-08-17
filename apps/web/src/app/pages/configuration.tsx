import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { api, type KiloModel, type ProviderCredentialView } from "../../api";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import { Separator } from "../../components/ui/separator";
import { messageOf } from "../domainViews";
import { ProjectFoldersCard } from "../components/projectFoldersCard";

export function ConfigurationPage() {
  const [providers, setProviders] = useState<ProviderCredentialView[]>([]);
  const [models, setModels] = useState<KiloModel[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [providerList, modelList, favoriteList] = await Promise.all([
        api.listProviderCredentials(),
        api.listModels(),
        api.listFavorites(),
      ]);
      setProviders(providerList.providers);
      setModels(modelList.models);
      setFavorites(new Set(favoriteList.models));
    } catch (err) {
      setError(messageOf(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveKey(provider: string) {
    const key = keys[provider] ?? "";
    if (!key.trim()) {
      toast.error("Enter a key to save.");
      return;
    }
    try {
      const updated = await api.setProviderCredential(provider, key.trim());
      setKeys((prev) => ({ ...prev, [provider]: "" }));
      setProviders((prev) => prev.map((p) => (p.provider === provider ? updated : p)));
      toast.success(`${provider} key saved (encrypted, never shown again).`);
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  async function removeKey(provider: string) {
    try {
      await api.removeProviderCredential(provider);
      setProviders((prev) =>
        prev.map((p) => (p.provider === provider ? { ...p, configured: false, masked: null } : p)),
      );
      toast.success(`${provider} key removed.`);
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  async function toggleFavorite(model: string) {
    const isFav = favorites.has(model);
    try {
      if (isFav) {
        await api.removeFavorite(model);
        setFavorites((prev) => {
          const next = new Set(prev);
          next.delete(model);
          return next;
        });
      } else {
        await api.addFavorite(model);
        setFavorites((prev) => new Set(prev).add(model));
      }
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  const sortedModels = [...models].sort((a, b) => {
    const aFav = favorites.has(a.id) || favorites.has(a.model);
    const bFav = favorites.has(b.id) || favorites.has(b.model);
    return Number(bFav) - Number(aFav);
  });

  return (
    <div className="space-y-8">
      <section aria-label="Provider credentials">
        <Card>
          <CardHeader>
            <CardTitle>Providers</CardTitle>
            <CardDescription>
              API keys are stored encrypted at rest and are never shown again. The task runner
              injects the key for the selected provider when running the Kilo agent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No providers available.</p>
            ) : (
              providers.map((provider) => (
                <div key={provider.provider} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`key-${provider.provider}`} className="capitalize">
                      {provider.provider}
                    </Label>
                    {provider.configured ? (
                      <Badge variant="outline">{provider.masked}</Badge>
                    ) : (
                      <Badge variant="secondary">not configured</Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id={`key-${provider.provider}`}
                      type="password"
                      placeholder={
                        provider.configured
                          ? "Replace the stored key…"
                          : `Paste your ${provider.provider} API key…`
                      }
                      value={keys[provider.provider] ?? ""}
                      onChange={(e) =>
                        setKeys((prev) => ({ ...prev, [provider.provider]: e.target.value }))
                      }
                    />
                    <Button
                      aria-label={`Save key for ${provider.provider}`}
                      onClick={() => void saveKey(provider.provider)}
                    >
                      Save key
                    </Button>
                    {provider.configured && (
                      <Button
                        variant="ghost"
                        aria-label={`Remove key for ${provider.provider}`}
                        onClick={() => void removeKey(provider.provider)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-label="Favorite models">
        <Card>
          <CardHeader>
            <CardTitle>Models</CardTitle>
            <CardDescription>
              Star your favorite models; they appear first in the task model picker across all
              projects.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sortedModels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No models detected on this Kilo installation.
              </p>
            ) : (
              <ul className="divide-y">
                {sortedModels.map((model) => {
                  const id = model.id || model.model;
                  const isFav = favorites.has(model.id) || favorites.has(model.model);
                  return (
                    <li key={id} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{model.model}</p>
                        <p className="text-xs text-muted-foreground">{model.provider}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                        onClick={() => void toggleFavorite(id)}
                      >
                        <Star
                          className={
                            isFav
                              ? "h-4 w-4 fill-amber-400 text-amber-400"
                              : "h-4 w-4 text-muted-foreground"
                          }
                          aria-hidden
                        />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <ProjectFoldersCard />
      <Separator />
    </div>
  );
}
