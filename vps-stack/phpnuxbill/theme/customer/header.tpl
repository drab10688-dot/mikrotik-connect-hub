<!DOCTYPE html>
<html lang="en" class="has-aside-left has-aside-mobile-transition has-navbar-fixed-top has-aside-expanded">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{$_title} - {$_c['CompanyName']}</title>

    <script>
        var appUrl = '{$app_url}';
    </script>

    <link rel="shortcut icon" href="{$app_url}/ui/ui/images/logo.png" type="image/x-icon" />
    <link rel="stylesheet" href="{$app_url}/ui/ui/styles/bootstrap.min.css">
    <link rel="stylesheet" href="{$app_url}/ui/ui/fonts/ionicons/css/ionicons.min.css">
    <link rel="stylesheet" href="{$app_url}/ui/ui/fonts/font-awesome/css/font-awesome.min.css">
    <link rel="stylesheet" href="{$app_url}/ui/ui/styles/modern-AdminLTE.min.css">
    <link rel="stylesheet" href="{$app_url}/ui/ui/styles/sweetalert2.min.css" />
    <script src="{$app_url}/ui/ui/scripts/sweetalert2.all.min.js"></script>
    <link rel="stylesheet" href="{$app_url}/ui/ui/styles/phpnuxbill.customer.css?2025.2.4" />

    <!-- OmniSync Theme -->
    <link rel="stylesheet" href="{$app_url}/ui/themes/omnisync/omnisync.css">

    <style>

    </style>

    {if isset($xheader)}
        {$xheader}
    {/if}

</head>

<body class="hold-transition modern-skin-dark sidebar-mini">
    <div class="wrapper">
        <header class="main-header" style="position:fixed; width: 100%">
            <a href="{Text::url('home')}" class="logo">
                <span class="logo-mini"><b>N</b>uX</span>
                <span class="logo-lg">{$_c['CompanyName']}</span>
            </a>
            <nav class="navbar navbar-static-top">
                <a href="#" class="sidebar-toggle" data-toggle="push-menu" role="button">
                    <span class="sr-only">Toggle navigation</span>
                </a>
                <div class="navbar-custom-menu">
                    <ul class="nav navbar-nav">
                        <li class="dropdown user user-menu">
                            <a href="#" class="dropdown-toggle" data-toggle="dropdown">
                                <img src="{$app_url}/ui/ui/images/default_avatar.png"
                                    class="user-image user-img img-circle" alt="User Image">
                                <span class="hidden-xs">{$_user['fullname']}</span>
                            </a>
                            <ul class="dropdown-menu">
                                <li class="user-header" style="background: linear-gradient(135deg, rgba(6,182,212,0.2), rgba(139,92,246,0.15)); border-bottom: 1px solid rgba(255,255,255,0.08);">
                                    <img src="{$app_url}/ui/ui/images/default_avatar.png"
                                        class="img-circle user-img" alt="User Image">
                                    <p>
                                        {$_user['fullname']}
                                        <small>{$_user['email']}</small>
                                    </p>
                                </li>
                                <li class="user-footer">
                                    <div class="pull-left">
                                        <a href="{Text::url('accounts/profile')}"
                                            class="btn btn-default btn-flat btn-sm">{Lang::T('My Account')}</a>
                                    </div>
                                    <div class="pull-right">
                                        <a href="{Text::url('logout')}"
                                            class="btn btn-default btn-flat btn-sm">{Lang::T('Logout')}</a>
                                    </div>
                                </li>
                            </ul>
                        </li>
                    </ul>
                </div>
            </nav>
        </header>
        <aside class="main-sidebar">
            <section class="sidebar">
                <div class="user-panel" style="padding: 12px 10px;">
                    <div class="pull-left image">
                        <img src="{$app_url}/ui/ui/images/default_avatar.png" class="img-circle user-img"
                            alt="User Image" style="border: 2px solid rgba(6,182,212,0.3);">
                    </div>
                    <div class="pull-left info">
                        <p>{$_user['fullname']}</p>
                        <a href="#"><i class="fa fa-circle" style="color:var(--os-success);"></i>
                            {if $_user['status']=='Active'}{Lang::T('Active')}{else}{$_user['status']}{/if}</a>
                    </div>
                </div>
                <ul class="sidebar-menu" data-widget="tree">
                    <li {if $_system_menu eq 'dashboard'}class="active" {/if}>
                        <a href="{Text::url('home')}">
                            <i class="ion ion-ios-speedometer-outline"></i>
                            <span>{Lang::T('Dashboard')}</span>
                        </a>
                    </li>
                    {if $_c['enable_balance'] == 'yes' && $_c['allow_balance_transfer'] == 'yes'}
                        <li {if $_system_menu eq 'sendbalance'}class="active" {/if}>
                            <a href="{Text::url('home&send=balance')}">
                                <i class="ion ion-ios-shuffle"></i>
                                <span>{Lang::T('Send Balance')}</span>
                            </a>
                        </li>
                    {/if}
                    {if $_c['disable_voucher'] != 'yes'}
                        <li {if $_system_menu eq 'voucher'}class="active" {/if}>
                            <a href="{Text::url('voucher/activation')}">
                                <i class="ion ion-ios-pricetags-outline"></i>
                                <span>{Lang::T('Voucher')}</span>
                            </a>
                        </li>
                        <li {if $_system_menu eq 'list-activation'}class="active" {/if}>
                            <a href="{Text::url('voucher/activation-list')}">
                                <i class="ion ion-ios-list-outline"></i>
                                <span>{Lang::T('Activation History')}</span>
                            </a>
                        </li>
                    {/if}
                    {if $_c['enable_balance'] == 'yes'}
                        <li {if $_system_menu eq 'order'}class="active" {/if}>
                            <a href="{Text::url('order/package')}">
                                <i class="ion ion-ios-cart-outline"></i>
                                <span>{Lang::T('Order Package')}</span>
                            </a>
                        </li>
                        <li {if $_system_menu eq 'history'}class="active" {/if}>
                            <a href="{Text::url('order/history')}">
                                <i class="ion ion-ios-time-outline"></i>
                                <span>{Lang::T('Order History')}</span>
                            </a>
                        </li>
                    {/if}
                    <li {if $_system_menu eq 'inbox'}class="active" {/if}>
                        <a href="{Text::url('mail')}">
                            <i class="ion ion-ios-email-outline"></i>
                            <span>{Lang::T('Inbox')}</span>
                        </a>
                    </li>
                    <li {if $_system_menu eq 'accounts'}class="active" {/if}>
                        <a href="{Text::url('accounts/profile')}">
                            <i class="ion ion-ios-person-outline"></i>
                            <span>{Lang::T('My Account')}</span>
                        </a>
                    </li>
                    <li {if $_system_menu eq 'change-password'}class="active" {/if}>
                        <a href="{Text::url('accounts/change-password')}">
                            <i class="ion ion-ios-locked-outline"></i>
                            <span>{Lang::T('Change Password')}</span>
                        </a>
                    </li>
                    <li>
                        <a href="{Text::url('logout')}">
                            <i class="ion ion-log-out"></i>
                            <span>{Lang::T('Logout')}</span>
                        </a>
                    </li>
                </ul>
            </section>
        </aside>

        <div class="content-wrapper">
            <section class="content">
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
