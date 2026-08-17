import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ChangeSummary } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { messageOf, statusBadgeVariant } from "../domainViews";

export function ChangesPage() {
  const navigate = useNavigate();
  const [changes, setChanges] = useState<ChangeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listChanges()
      .then((list) => {
        setChanges(list);
        setLoading(false);
      })
      .catch((err) => {
        setError(messageOf(err));
        setLoading(false);
      });
  }, []);

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading changes…</p>;
  }

  return (
    <section aria-label="Changes list">
      <Card>
        <CardHeader>
          <CardTitle>Changes</CardTitle>
        </CardHeader>
        <CardContent>
          {changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes yet.</p>
          ) : (
            <ul className="divide-y">
              {changes.map((change) => (
                <li key={change.id} className="flex items-center justify-between py-2">
                  <Button
                    variant="link"
                    className="h-auto justify-start px-0 font-medium"
                    onClick={() => navigate(`/changes/${change.id}`)}
                  >
                    {change.title}
                  </Button>
                  <Badge variant={statusBadgeVariant(change.status)}>{change.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
