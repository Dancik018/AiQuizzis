export const accountErrors: Record<string, [number, string]> = {
  AUTH_REQUIRED: [401, 'Autentifică-te pentru a continua.'],
  AUTH_SETUP: [503, 'Configurarea conturilor nu este încă finalizată. Reîncearcă mai târziu.'],
  ACCOUNT_BLOCKED: [403, 'Contul este suspendat. Contactează administratorul.'],
  EMAIL_UNVERIFIED: [403, 'Confirmă adresa de email înainte de a continua.'],
  PASSWORD_CHANGE_REQUIRED: [
    403,
    'Schimbă parola temporară pentru a activa contul de administrator.',
  ],
  ADMIN_REQUIRED: [403, 'Această acțiune este disponibilă numai administratorului.'],
  INSUFFICIENT_CREDITS: [
    409,
    'Numărul de eliminat depășește generările disponibile. Reîncarcă lista și încearcă din nou.',
  ],
  NO_CREDITS: [
    402,
    'Nu mai ai generări disponibile. Cere administratorului încercări suplimentare.',
  ],
  DOCUMENT_NOT_FOUND: [404, 'Documentul nu există în contul tău.'],
  DOCUMENT_AI_LIMIT: [
    429,
    'Bugetul de analiză pentru acest document este epuizat. Verifică întrebările rămase manual.',
  ],
  WRITE_CONFLICT: [
    409,
    'Documentul a fost modificat în altă filă sau pe alt dispozitiv. Reîncarcă pagina înainte de a continua.',
  ],
  SOURCE_IMMUTABLE: [409, 'Pentru un document diferit folosește o încărcare nouă.'],
  DELETE_CONFIRMATION: [400, 'Confirmă ștergerea introducând adresa corectă de email.'],
  ADMIN_PROTECTED: [403, 'Conturile de administrator nu pot fi șterse.'],
  USER_NOT_FOUND: [404, 'Utilizatorul nu poate fi modificat.'],
  INVALID_DATA: [400, 'Datele trimise nu sunt valide.'],
};
export function accountFailure(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const entry = accountErrors[code];
  return entry
    ? Response.json(
        { error: entry[1], code },
        { status: entry[0], headers: { 'Cache-Control': 'no-store' } },
      )
    : undefined;
}
