{include file="customer/header-public.tpl"}

<div class="hidden-xs" style="height:60px"></div>
<div class="row">
    <div class="col-sm-6 col-sm-offset-1">
        <div class="panel panel-info">
            <div class="panel-heading">
                <i class="glyphicon glyphicon-bullhorn" style="margin-right:8px;"></i>
                {Lang::T('Announcement')}
            </div>
            <div class="panel-body">
                {if isset($Rone)}{$Rone}{/if}
            </div>
        </div>
    </div>
    <div class="col-sm-4">
        <div class="panel panel-primary">
            <div class="panel-heading">
                <i class="glyphicon glyphicon-log-in" style="margin-right:8px;"></i>
                {Lang::T('Log in to Member Panel')}
            </div>
            <div class="panel-body">
                <form action="{$_url}login/post" method="post">
                    <input type="hidden" name="csrf_token" value="{$csrf_token}">
                    <div class="form-group">
                        <label>{Lang::T('Usernames')}</label>
                        <div class="input-group">
                            <span class="input-group-addon"><i class="glyphicon glyphicon-user"></i></span>
                            <input type="text" class="form-control" name="username" placeholder="{Lang::T('Usernames')}">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>{Lang::T('Password')}</label>
                        <div class="input-group">
                            <span class="input-group-addon"><i class="glyphicon glyphicon-lock"></i></span>
                            <input type="password" class="form-control" name="password" placeholder="{Lang::T('Password')}">
                        </div>
                    </div>
                    <div class="btn-group btn-group-justified mb15" style="margin-top:8px;">
                        <div class="btn-group">
                            <a href="{$_url}register" class="btn btn-success">{Lang::T('Register')}</a>
                        </div>
                        <div class="btn-group">
                            <button type="submit" class="btn btn-primary">{Lang::T('Login')}</button>
                        </div>
                    </div>
                    <br>
                    <center>
                        <a href="{$_url}forgot" class="btn btn-link">{Lang::T('Forgot Password')}</a>
                    </center>
                </form>
            </div>
        </div>
    </div>
</div>

<!-- Voucher Quick Activation -->
<div class="row">
    <div class="col-sm-4 col-sm-offset-7">
        <div class="panel panel-success">
            <div class="panel-heading">
                <i class="glyphicon glyphicon-qrcode" style="margin-right:8px;"></i>
                {Lang::T('Voucher')} - {Lang::T('Activation')}
            </div>
            <div class="panel-body">
                <form action="{$_url}voucher/activation" method="post">
                    <input type="hidden" name="csrf_token" value="{$csrf_token}">
                    <div class="form-group" style="margin-bottom:10px;">
                        <div class="input-group">
                            <span class="input-group-addon"><i class="glyphicon glyphicon-barcode"></i></span>
                            <input type="text" class="form-control" name="code" placeholder="{Lang::T('Voucher Code')}" required>
                        </div>
                    </div>
                    <button type="submit" class="btn btn-success btn-block">
                        <i class="glyphicon glyphicon-ok" style="margin-right:6px;"></i>
                        {Lang::T('Recharge')}
                    </button>
                </form>
            </div>
        </div>
    </div>
</div>

<!-- Modal -->
<div class="modal fade" id="HTMLModal" tabindex="-1" role="dialog">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
            </div>
            <div class="modal-body" id="HTMLModal_konten"></div>
            <div class="modal-footer">
                <button type="button" class="btn btn-default" data-dismiss="modal">&times;</button>
            </div>
        </div>
    </div>
</div>

{include file="customer/footer-public.tpl"}
