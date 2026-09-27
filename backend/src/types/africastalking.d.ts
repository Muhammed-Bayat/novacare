declare module 'africastalking' {
  export interface SmsRecipient {
    number?: string;
    messageId?: string;
    status?: string;
    statusCode?: number;
    cost?: string;
  }

  export interface SmsSendResult {
    SMSMessageData?: {
      Message?: string;
      Recipients?: SmsRecipient[];
    };
  }

  export interface SmsService {
    send(options: { to: string[]; message: string }): Promise<SmsSendResult>;
  }

  export interface AfricasTalkingSdk {
    SMS: SmsService;
  }

  export default function AfricasTalking(credentials: { username: string; apiKey: string }): AfricasTalkingSdk;
}
