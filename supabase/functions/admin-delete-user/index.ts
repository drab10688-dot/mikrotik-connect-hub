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

    const { data: roleData, error: roleError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', requestingUser.id)
      .single();

    if (roleError || roleData?.role !== 'super_admin') {
      return new Response(
        JSON.stringify({ error: 'No tienes permisos para eliminar usuarios' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { userId } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'userId es requerido' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Eliminando usuario:', userId);

    // Primero eliminar accesos a dispositivos
    const { error: accessError } = await supabaseClient
      .from('user_mikrotik_access')
      .delete()
      .eq('user_id', userId);

    if (accessError) {
      console.error('Error eliminando accesos:', accessError);
    } else {
      console.log('Accesos eliminados exitosamente');
    }

    // Eliminar roles del usuario
    const { error: rolesError } = await supabaseClient
      .from('user_roles')
      .delete()
      .eq('user_id', userId);

    if (rolesError) {
      console.error('Error eliminando roles:', rolesError);
    } else {
      console.log('Roles eliminados exitosamente');
    }

    // Eliminar perfil del usuario
    const { error: profileError } = await supabaseClient
      .from('profiles')
      .delete()
      .eq('user_id', userId);

    if (profileError) {
      console.error('Error eliminando perfil:', profileError);
    } else {
      console.log('Perfil eliminado exitosamente');
    }

    // Verificar si el usuario existe en auth antes de intentar eliminarlo
    const { data: authUser, error: getUserError } = await supabaseClient.auth.admin.getUserById(userId);

    if (getUserError) {
      console.log('Usuario no encontrado en auth.users, probablemente ya fue eliminado');
      // Si el usuario no existe en auth, consideramos la operación exitosa
      // ya que los datos relacionados fueron eliminados
      return new Response(
        JSON.stringify({ success: true, message: 'Usuario y datos relacionados eliminados' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Si el usuario existe en auth, eliminarlo
    const { error: deleteError } = await supabaseClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('Error al eliminar usuario de auth:', deleteError);
      return new Response(
        JSON.stringify({ error: 'Error al eliminar usuario: ' + deleteError.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Usuario eliminado completamente de auth');

    return new Response(
      JSON.stringify({ success: true }),
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
