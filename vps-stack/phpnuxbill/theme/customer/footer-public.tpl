        </div><!-- /.container -->

        <footer class="text-center" style="padding:20px 0; opacity:0.6; font-size:12px;">
            <p>&copy; {$smarty.now|date_format:"%Y"} {$_c['CompanyName']} &bull; Powered by <a href="https://phpnuxbill.com" target="_blank" style="color:inherit;">PHPNuxBill</a></p>
        </footer>

        <script src="{$app_url}/ui/ui/scripts/jquery.min.js"></script>
        <script src="{$app_url}/ui/ui/scripts/bootstrap.min.js"></script>

        <script>
            function showPrivacy() {
                Swal.fire({ title: 'Privacy Policy', html: '{if isset($_c["privacy"])}{ $_c["privacy"]}{else}Contact administrator.{/if}', icon: 'info' });
            }
            function showTaC() {
                Swal.fire({ title: 'Terms & Conditions', html: '{if isset($_c["tos"])}{ $_c["tos"]}{else}Contact administrator.{/if}', icon: 'info' });
            }
        </script>

    </body>
</html>
