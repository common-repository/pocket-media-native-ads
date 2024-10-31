<?php
/*
Plugin Name: Pocket Media Native ads
Plugin URI: http://pocketmedia.mobi
Description: This plugin loads the Pocket Media Native Ads library
Author: Pocket Media
Author URI: http://nativeads.pocketmedia.mobi
version: 1.1
*/
add_action('wp_enqueue_scripts','load_ad_library');
add_action( 'admin_menu', 'pm_native_add_admin_menu' );
add_action( 'admin_init', 'pm_native_settings_init' );
add_filter( 'plugin_action_links_' . plugin_basename(__FILE__), 'add_action_links' );

function load_ad_library() {
  wp_enqueue_script('pm-native-ads', plugin_dir_url(__FILE__) . 'js/pm-native.js');
  wp_enqueue_script('pm-native-ads-init', plugin_dir_url(__FILE__) . 'js/pm-native-init.js');
  $options = get_option('pm_native_settings');
  $available_vars = array(
    'application_id' => $options['pm_native_application_id'],
    'library_location' => plugin_dir_url(__FILE__) . 'js/pm-native.js'
  );
  wp_localize_script( 'pm-native-ads-init', 'pm_native_vars', $available_vars);
}

function add_action_links ( $links ) {
 $mylinks = array(
   '<a href="' . admin_url( 'admin.php?page=pocket_media_native_ads' ) . '">Settings</a>',
 );
 return array_merge($mylinks, $links);
}

function pm_native_add_admin_menu(  ) {
	add_menu_page( 'Pocket Media Native ads', 'Pocket Media Native ads', 'manage_options', 'pocket_media_native_ads', 'pm_native_options_page' );
}

function pm_native_settings_init(  ) {
	register_setting( 'pluginPage', 'pm_native_settings' );
	add_settings_section(
		'pm_native_pluginPage_section',
		__( 'Details', 'wordpress' ),
		'pm_native_settings_section_callback',
		'pluginPage'
	);

	add_settings_field(
		'pm_native_application_id',
		__( 'Application id', 'wordpress' ),
		'pm_native_application_id',
		'pluginPage',
		'pm_native_pluginPage_section'
	);
}


function pm_native_application_id(  ) {
	$options = get_option( 'pm_native_settings' );
	?>
	<input type='text' name='pm_native_settings[pm_native_application_id]' value='<?php echo $options['pm_native_application_id']; ?>'>
	<?php
}


function pm_native_settings_section_callback(  ) {
	echo __( 'On this page you can configure the applicationId to use for Pocket Media native ads', 'wordpress' );
}


function pm_native_options_page(  ) {
	?>
	<form action='options.php' method='post'>

		<h2>Pocket Media Native ads</h2>

		<?php
		settings_fields( 'pluginPage' );
		do_settings_sections( 'pluginPage' );
		submit_button();
		?>

	</form>
	<?php

}

?>
