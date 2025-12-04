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

    // Verificar que el usuario sea super_admin o admin
    const { data: roleData, error: roleError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', requestingUser.id)
      .single();

    const isSuperAdmin = roleData?.role === 'super_admin';
    const isAdmin = roleData?.role === 'admin' || isSuperAdmin;

    if (roleError || !isAdmin) {
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

    // Si es admin (no super_admin), solo puede crear secretarias
    if (!isSuperAdmin && role !== 'secretary') {
      return new Response(
        JSON.stringify({ error: 'Solo puedes crear usuarios con rol de secretaria' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Verificar si el usuario ya existe
    const { data: existingUsers } = await supabaseClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);

    let userId: string;

    if (existingUser) {
      // Usuario ya existe, solo actualizar rol
      userId = existingUser.id;
      
      // Verificar si ya tiene el rol
      const { data: existingRole } = await supabaseClient
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();

      if (existingRole) {
        // Actualizar rol existente
        const { error: updateRoleError } = await supabaseClient
          .from('user_roles')
          .update({ role: role })
          .eq('user_id', userId);

        if (updateRoleError) {
          return new Response(
            JSON.stringify({ error: 'Error al actualizar rol: ' + updateRoleError.message }),
            { 
              status: 500, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
      } else {
        // Insertar nuevo rol
        const { error: insertRoleError } = await supabaseClient
          .from('user_roles')
          .insert({ user_id: userId, role: role });

        if (insertRoleError) {
          return new Response(
            JSON.stringify({ error: 'Error al asignar rol: ' + insertRoleError.message }),
            { 
              status: 500, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          user: {
            id: userId,
            email: email,
          },
          existing: true
        }),
        { 
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

    userId = newUser.user.id;

    // Crear el perfil del usuario
    const { error: profileError } = await supabaseClient
      .from('profiles')
      .insert({
        user_id: userId,
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
        user_id: userId,
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
          id: userId,
          email: email,
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
