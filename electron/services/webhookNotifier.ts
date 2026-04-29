export type WebhookService = "none" | "slack" | "discord" | "teams";

export async function sendWebhookNotification(service: WebhookService, url: string, phrase: string): Promise<void> {
  if (service === "none" || !url.trim()) return;

  let body: string;
  switch (service) {
    case "slack":
      body = JSON.stringify({ text: phrase });
      break;
    case "discord":
      body = JSON.stringify({ content: phrase });
      break;
    case "teams":
      body = JSON.stringify({
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        text: phrase,
      });
      break;
    default:
      return;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!response.ok) {
      console.warn(`[Webhook] Failed: ${response.status} ${response.statusText}`);
    } else {
      console.log(`[Webhook] Sent to ${service}`);
    }
  } catch (error) {
    console.error("[Webhook] Error:", error);
  }
}
