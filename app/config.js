/* Vigías del Fuego · conexión con la operación de campo (Supabase).
   Es el mismo proyecto que usan la aplicación de guardabosques y el tablero de campo.
   La clave es la clave pública (publishable) del proyecto: la seguridad la dan las políticas RLS y el inicio de sesión.
   Nunca coloque aquí la clave service_role ni contraseñas. */
window.VF_CONFIG = {
  supabaseUrl: 'https://vhhfcnuchlxmrzymqaph.supabase.co',
  supabaseKey: 'sb_publishable_GqdlBUSD0my5J1SGKJXu1Q_ipTqbERa',
  tablas: {
    alertas: 'alertas',
    reportes: 'reportes_incendio',
    novedades: 'novedades_guardabosque',
    posiciones: 'posiciones_guardabosque',
    perfiles: 'perfiles'
  },
  appCampo: 'https://digitalisatrax-red.github.io/app-incendios-caldas/',
  tableroCampo: 'https://digitalisatrax-red.github.io/app-incendios-caldas/dashboard.html'
};
