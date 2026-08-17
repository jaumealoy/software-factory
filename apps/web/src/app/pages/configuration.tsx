import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

export function ConfigurationPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project configuration</CardTitle>
        <CardDescription>
          Manage provider credentials and favorite models here (arrives with the Factory
          Configuration screen).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">No configuration yet.</p>
      </CardContent>
    </Card>
  );
}
