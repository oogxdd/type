const STONE_ICON: &[u8] = include_bytes!("../../../src/assets/app-icons/stone.png");
const STONE_XL_ICON: &[u8] = include_bytes!("../../../src/assets/app-icons/stone-xl.png");
const GLASS_ICON: &[u8] = include_bytes!("../../../src/assets/app-icons/glass.png");
const GLASS_XL_ICON: &[u8] = include_bytes!("../../../src/assets/app-icons/glass-xl.png");
const PAPER_ICON: &[u8] = include_bytes!("../../../src/assets/app-icons/paper.png");
const FOREST_ICON: &[u8] = include_bytes!("../../../src/assets/app-icons/forest.png");
const GARNET_ICON: &[u8] = include_bytes!("../../../src/assets/app-icons/garnet.png");
const ICE_ICON: &[u8] = include_bytes!("../../../src/assets/app-icons/ice.png");
const CHARCOAL_ICON: &[u8] = include_bytes!("../../../src/assets/app-icons/charcoal.png");
const STEEL_ICON: &[u8] = include_bytes!("../../../src/assets/app-icons/steel.png");

fn icon_bytes(icon_id: &str) -> Result<&'static [u8], String> {
    match icon_id {
        "stone" => Ok(STONE_ICON),
        "stone-xl" => Ok(STONE_XL_ICON),
        "glass" => Ok(GLASS_ICON),
        "glass-xl" => Ok(GLASS_XL_ICON),
        "paper" => Ok(PAPER_ICON),
        "forest" => Ok(FOREST_ICON),
        "garnet" => Ok(GARNET_ICON),
        "ice" => Ok(ICE_ICON),
        "charcoal" => Ok(CHARCOAL_ICON),
        "steel" => Ok(STEEL_ICON),
        _ => Err(format!("unknown app icon: {icon_id}")),
    }
}

#[cfg(target_os = "macos")]
fn apply_macos_app_icon(icon_bytes: &'static [u8]) -> Result<(), String> {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let data: *mut Object = msg_send![
            class!(NSData),
            dataWithBytes: icon_bytes.as_ptr()
            length: icon_bytes.len()
        ];
        if data.is_null() {
            return Err("could not create NSData for the app icon".to_string());
        }

        let image: *mut Object = msg_send![class!(NSImage), alloc];
        let image: *mut Object = msg_send![image, initWithData: data];
        if image.is_null() {
            return Err("could not decode the app icon PNG".to_string());
        }

        let application: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![application, setApplicationIconImage: image];
        let _: () = msg_send![image, release];
    }

    Ok(())
}

#[tauri::command]
pub(super) async fn set_app_icon(
    app: tauri::AppHandle,
    args: SetAppIconArgs,
) -> Result<(), String> {
    let bytes = icon_bytes(&args.icon_id)?;

    #[cfg(target_os = "macos")]
    {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        app.run_on_main_thread(move || {
            let _ = sender.blocking_send(apply_macos_app_icon(bytes));
        })
        .map_err(|error| error.to_string())?;

        return receiver
            .recv()
            .await
            .ok_or_else(|| "app icon update was cancelled".to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, bytes);
        Err("runtime app icon selection is currently supported on macOS only".to_string())
    }
}

#[derive(serde::Deserialize)]
pub(super) struct SetAppIconArgs {
    icon_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_every_supported_icon() {
        for icon_id in [
            "stone",
            "stone-xl",
            "glass",
            "glass-xl",
            "paper",
            "forest",
            "garnet",
            "ice",
            "charcoal",
            "steel",
        ] {
            assert!(!icon_bytes(icon_id).unwrap().is_empty());
        }
    }

    #[test]
    fn rejects_unknown_icons() {
        assert!(icon_bytes("checkerboard").is_err());
    }
}
