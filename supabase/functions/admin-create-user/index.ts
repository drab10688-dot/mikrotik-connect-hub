import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Verificar autenticación del usuario que hace la petición
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    
    const { data: { user: requestingUser }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !requestingUser) {
      return new Response(
        JSON.stringify({ error: 'No autorizado' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Verificar que el usuario sea super_admin
    const { data: roleData, error: roleError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', requestingUser.id)
      .single();

    if (roleError || roleData?.role !== 'super_admin') {
      return new Response(
        JSON.stringify({ error: 'No tienes permisos para crear usuarios' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Obtener datos del nuevo usuario
    const { email, password, fullName, role } = await req.json();

    if (!email || !password || !role) {
      return new Response(
        JSON.stringify({ error: 'Email, contraseña y rol son requeridos' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Crear el usuario usando el admin API
    const { data: newUser, error: createError } = await supabaseClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirmar el email
      user_metadata: {
        full_name: fullName,
      },
    });

    if (createError) {
      return new Response(
        JSON.stringify({ error: createError.message }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    if (!newUser.user) {
      return new Response(
        JSON.stringify({ error: 'No se pudo crear el usuario' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Crear el perfil del usuario
    const { error: profileError } = await supabaseClient
      .from('profiles')
      .insert({
        user_id: newUser.user.id,
        email: email,
        full_name: fullName,
      });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      // No fallar si hay error en el perfil, continuar con el rol
    }

    // Asignar el rol al usuario
    const { error: roleInsertError } = await supabaseClient
      .from('user_roles')
      .insert({
        user_id: newUser.user.id,
        role: role,
      });

    if (roleInsertError) {
      return new Response(
        JSON.stringify({ error: 'Usuario creado pero error al asignar rol: ' + roleInsertError.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        user: {
          id: newUser.user.id,
          email: newUser.user.email,
        }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || 'Error desconocido' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
