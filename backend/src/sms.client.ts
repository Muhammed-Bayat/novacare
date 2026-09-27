import AfricasTalking from 'africastalking';

let smsService: ReturnType<typeof AfricasTalking>['SMS'] | null = null;

function getSmsService() {
  if (!smsService) {
    const username = process.env.AT_USERNAME;
    const apiKey = process.env.AT_API_KEY;
    if (!username || !apiKey) throw new Error('Africa\'s Talking credentials are not configured (AT_USERNAME/AT_API_KEY).');
    if (username !== 'sandbox') throw new Error(`Refusing to send SMS with non-sandbox AT_USERNAME "${username}".`);
    smsService = AfricasTalking({ username, apiKey }).SMS;
  }
  return smsService;
}

export type SmsDelivery = { messageId?: string; status?: string; statusCode?: number };

export async function sendSms(to: string, message: string): Promise<SmsDelivery> {
  const result = await getSmsService().send({ to: [to], message });
  const recipient = result.SMSMessageData?.Recipients?.[0];
  return { messageId: recipient?.messageId, status: recipient?.status, statusCode: recipient?.statusCode };
}
