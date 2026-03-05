<!DOCTYPE html>
<html lang="es">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <title>{$_title} - {$_c['CompanyName']}</title>
    <link rel="shortcut icon" href="{$app_url}/ui/ui/images/logo.png" type="image/x-icon" />

    <script>
        var appUrl = '{$app_url}';
    </script>

    <link rel="stylesheet" href="{$app_url}/ui/ui/styles/bootstrap.min.css">
    <link rel="stylesheet" href="{$app_url}/ui/ui/styles/modern-AdminLTE.min.css">
    <link rel="stylesheet" href="{$app_url}/ui/ui/styles/sweetalert2.min.css" />
    <script src="{$app_url}/ui/ui/scripts/sweetalert2.all.min.js"></script>

    {* ── OmniSync Portal Theme ── *}
    <style>
        :root {
            --os-primary: #06b6d4;
            --os-primary-dark: #0891b2;
            --os-accent: #8b5cf6;
            --os-bg: #0f172a;
            --os-bg-card: rgba(30, 41, 59, 0.85);
            --os-text: #f1f5f9;
            --os-text-muted: #94a3b8;
            --os-border: rgba(51, 65, 85, 0.6);
            --os-glass: rgba(15, 23, 42, 0.6);
        }

        * { box-sizing: border-box; }

        body {
            margin: 0;
            padding: 0;
            min-height: 100vh;
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
            background: var(--os-bg);
            color: var(--os-text);
            overflow-x: hidden;
        }

        body::before {
            content: '';
            position: fixed;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background:
                radial-gradient(ellipse at 20% 50%, rgba(6, 182, 212, 0.12) 0%, transparent 50%),
                radial-gradient(ellipse at 80% 20%, rgba(139, 92, 246, 0.10) 0%, transparent 50%),
                radial-gradient(ellipse at 50% 80%, rgba(6, 182, 212, 0.08) 0%, transparent 50%);
            animation: bgFloat 20s ease-in-out infinite alternate;
            z-index: 0;
            pointer-events: none;
        }

        @keyframes bgFloat {
            0% { transform: translate(0, 0) rotate(0deg); }
            100% { transform: translate(-30px, -20px) rotate(3deg); }
        }

        .container {
            position: relative;
            z-index: 1;
            max-width: 100%;
            padding: 0;
        }

        .form-head {
            text-align: center;
            padding: 20px 15px 10px;
        }

        .form-head h1 {
            color: var(--os-primary) !important;
            text-shadow: 0 0 30px rgba(6, 182, 212, 0.3) !important;
            font-size: 1.5rem;
            font-weight: 700;
            letter-spacing: 1px;
        }

        .form-head hr {
            border-color: var(--os-border);
            margin: 10px auto;
            max-width: 200px;
        }

        .panel, .box {
            background: var(--os-bg-card) !important;
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid var(--os-border) !important;
            border-radius: 16px !important;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
            overflow: hidden;
            margin-bottom: 20px;
        }

        .panel-heading, .panel-primary > .panel-heading, .panel-info > .panel-heading,
        .box-header {
            background: linear-gradient(135deg, rgba(6, 182, 212, 0.15), rgba(139, 92, 246, 0.10)) !important;
            border-bottom: 1px solid var(--os-border) !important;
            color: var(--os-text) !important;
            padding: 14px 18px;
            font-weight: 600;
        }

        .panel-body, .box-body {
            padding: 20px 18px;
            color: var(--os-text);
        }

        .form-control {
            background: rgba(15, 23, 42, 0.7) !important;
            border: 1px solid var(--os-border) !important;
            border-radius: 10px !important;
            color: var(--os-text) !important;
            padding: 10px 14px;
            height: auto;
            font-size: 14px;
            transition: all 0.3s;
        }

        .form-control:focus {
            border-color: var(--os-primary) !important;
            box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.2) !important;
        }

        .form-control::placeholder {
            color: var(--os-text-muted);
        }

        .input-group-addon {
            background: rgba(6, 182, 212, 0.1) !important;
            border: 1px solid var(--os-border) !important;
            border-radius: 10px 0 0 10px !important;
            color: var(--os-primary) !important;
        }

        .input-group .form-control:first-child {
            border-radius: 10px 0 0 10px !important;
        }

        .input-group .form-control:last-child,
        .input-group-btn:last-child > .btn {
            border-radius: 0 10px 10px 0 !important;
        }

        .btn-primary, .btn-success, .btn-info {
            background: linear-gradient(135deg, var(--os-primary), var(--os-primary-dark)) !important;
            border: none !important;
            border-radius: 10px !important;
            color: #fff !important;
            font-weight: 600;
            padding: 10px 24px;
            transition: all 0.3s;
            box-shadow: 0 4px 14px rgba(6, 182, 212, 0.3);
        }

        .btn-primary:hover, .btn-success:hover, .btn-info:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(6, 182, 212, 0.4);
            filter: brightness(1.1);
        }

        .btn-default {
            background: rgba(51, 65, 85, 0.5) !important;
            border: 1px solid var(--os-border) !important;
            border-radius: 10px !important;
            color: var(--os-text) !important;
        }

        .btn-default:hover {
            background: rgba(6, 182, 212, 0.15) !important;
            color: var(--os-primary) !important;
        }

        label, .control-label {
            color: var(--os-text-muted) !important;
            font-weight: 500;
            font-size: 13px;
        }

        a { color: var(--os-primary); }
        a:hover { color: #22d3ee; }

        .text-center { text-align: center; }

        /* ── Responsive ── */
        @media (max-width: 767px) {
            .container { padding: 10px; }
            .panel, .box { border-radius: 12px !important; }
            .form-head h1 { font-size: 1.2rem; }
        }
    </style>

    {if isset($xheader)}
        {$xheader}
    {/if}
</head>

<body id="app" class="app off-canvas body-full">
    <div class="container">
        <div class="form-head mb20">
            {if $_c['CompanyLogo']}
                <img src="{$_c['CompanyLogo']}" alt="{$_c['CompanyName']}" 
                     style="max-height:60px; margin-bottom:8px; filter: drop-shadow(0 0 8px rgba(6,182,212,0.3));">
                <br>
            {/if}
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
