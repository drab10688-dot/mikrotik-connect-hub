{include file="customer/header-public.tpl"}

<div style="max-width:900px; margin:0 auto; padding:0 10px;">
<div class="row">

    {* ── Left Column: Announcements ── *}
    <div class="col-sm-6 col-sm-offset-0">
        <div class="panel panel-info">
            <div class="panel-heading">
                <i class="glyphicon glyphicon-bullhorn"></i> {Lang::T('Announcement')}
            </div>
            <div class="panel-body">
                {$Announcement = "{$PAGES_PATH}/Announcement.html"}
                {if file_exists($Announcement)}
                    {include file=$Announcement}
                {/if}
            </div>
        </div>
    </div>

    {* ── Right Column: Login + Voucher + QR ── *}
    <div class="col-sm-6">

        {* ── Tab Navigation ── *}
        <div style="display:flex; margin-bottom:0; border-radius:12px 12px 0 0; overflow:hidden; border:1px solid rgba(51,65,85,0.6); border-bottom:none;">
