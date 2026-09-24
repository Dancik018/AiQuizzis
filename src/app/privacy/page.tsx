import Link from 'next/link';
export default function PrivacyPage() {
  return (
    <main className="auth-shell">
      <article className="auth-card">
        <h1>Datele tale în AiQuizzis</h1>
        <p>
          AiQuizzis folosește un cont pentru a păstra separat documentele, întrebările, quiz-urile
          și progresul fiecărui utilizator.
        </p>
        <h2>Ce se salvează</h2>
        <p>
          Supabase gestionează autentificarea și stochează emailul, identificatorul contului,
          numărul de încercări, textul extras din documente, întrebările, răspunsurile și istoricul
          quiz-urilor. Parolele sunt gestionate de Supabase Auth și nu sunt afișate
          administratorului.
        </p>
        <h2>Documente și inteligență artificială</h2>
        <p>
          PDF și DOCX sunt citite în browser. Fișierul original nu este încărcat pe serverul
          aplicației. Textul extras și rezultatele sunt salvate în cont. Întrebările și răspunsurile
          relevante sunt trimise serviciului OpenAI pentru rezolvare, generarea variantelor și
          verificare. Nu încărca documente pe care nu ai dreptul să le prelucrezi.
        </p>
        <h2>Conectare cu Google</h2>
        <p>
          Google furnizează identitatea de bază și adresa de email pentru autentificare. Aplicația
          nu solicită acces la Gmail, Google Drive sau calendar.
        </p>
        <h2>Browser și administrare</h2>
        <p>
          Cookie-urile de sesiune sunt necesare autentificării. Browserul păstrează preferințe și un
          cache al răspunsurilor separat pentru fiecare cont. Administratorul gestionează
          emailurile, încercările și suspendarea conturilor; meniul de administrare nu afișează
          documentele sau răspunsurile private ale altor utilizatori.
        </p>
        <h2>Ștergere și contact</h2>
        <p>
          Poți șterge documentele din bibliotecă. Quiz-urile deja salvate rămân în istoric. Pentru
          ștergerea completă a contului și a datelor asociate sau pentru întrebări despre date,
          contactează <a href="mailto:ursud09@gmail.com">ursud09@gmail.com</a>. Datele sunt păstrate
          până la ștergere; copiile de siguranță și jurnalele furnizorilor pot avea perioade proprii
          de retenție.
        </p>
        <p>
          Infrastructura aplicației folosește Vercel, Supabase și OpenAI. Procesarea de către acești
          furnizori este supusă propriilor politici privind datele.
        </p>
        <Link href="/">Înapoi la aplicație</Link>
      </article>
    </main>
  );
}
