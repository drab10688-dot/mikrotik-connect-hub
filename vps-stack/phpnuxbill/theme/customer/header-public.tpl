<!DOCTYPE html>
<html>

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
    <title>{$_title} - {$_c['CompanyName']}</title>
    <link rel="shortcut icon" href="{$app_url}/ui/ui/images/logo.png" type="image/x-icon" />

    <script>
        var appUrl = '{$app_url}';
    </script>

    <link rel="stylesheet" href="{$app_url}/ui/ui/styles/bootstrap.min.css">
    <link rel="stylesheet" href="{$app_url}/ui/ui/styles/modern-AdminLTE.min.css">
    <link rel="stylesheet" href="{$app_url}/ui/ui/styles/sweetalert2.min.css" />
    <script src="{$app_url}/ui/ui/scripts/sweetalert2.all.min.js"></script>

    <!-- OmniSync Theme -->
    <link rel="stylesheet" href="{$app_url}/ui/themes/omnisync/omnisync.css">

</head>

<body id="app" class="app off-canvas body-full">
    <!-- Animated background orbs -->
    <div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;overflow:hidden;pointer-events:none;">
        <div style="position:absolute;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(6,182,212,0.12),transparent 70%);top:-100px;left:-100px;animation:floatOrb 15s ease-in-out infinite;"></div>
        <div style="position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(139,92,246,0.1),transparent 70%);bottom:-150px;right:-150px;animation:floatOrb 18s ease-in-out infinite reverse;"></div>
        <div style="position:absolute;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(6,182,212,0.06),transparent 70%);top:50%;left:50%;transform:translate(-50%,-50%);animation:floatOrb 20s ease-in-out infinite;"></div>
    </div>
    <style>
        @keyframes floatOrb { 0%,100%{transform:translate(0,0)} 33%{transform:translate(30px,-30px)} 66%{transform:translate(-20px,20px)} }
    </style>

    <div class="container">
        <div class="form-head mb20" style="padding-top:30px;">
            <h1 class="site-logo h2 mb5 mt5 text-center text-uppercase text-bold">{$_c['CompanyName']}</h1>
            <hr>
        </div>
        {if isset($notify)}
            <script>
                Swal.fire({
                    icon: '{if $notify_t == "s"}success{else}warning{/if}',
                    title: '{$notify}',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 5000,
                    timerProgressBar: true,
                    didOpen: (toast) => {
                        toast.addEventListener('mouseenter', Swal.stopTimer)
                        toast.addEventListener('mouseleave', Swal.resumeTimer)
                    }
                });
            </script>
        {/if}
