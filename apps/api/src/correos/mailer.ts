import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';

export interface Adjunto {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface Mensaje {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Adjunto[];
}

/** Quien manda los correos. En las pruebas es uno de mentiras que los guarda. */
export interface Mailer {
  send(m: Mensaje): Promise<void>;
}

/**
 * El correo por SMTP (Google Workspace de la hacienda). `null` si no está
 * configurado: entonces no se manda nada y la aplicación sigue igual.
 */
export function crearMailer(config: AppConfig): Mailer | null {
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) return null;
  const transporte = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
  const from = config.MAIL_FROM ?? config.SMTP_USER;
  return {
    async send(m) {
      await transporte.sendMail({
        from,
        to: m.to,
        ...(config.MAIL_BCC ? { bcc: config.MAIL_BCC } : {}),
        ...(config.MAIL_REPLY_TO ? { replyTo: config.MAIL_REPLY_TO } : {}),
        subject: m.subject,
        html: m.html,
        text: m.text,
        attachments: m.attachments,
      });
    },
  };
}
