import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";

export function SettingsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Global factory settings will appear here.</p>
      </CardContent>
    </Card>
  );
}
