// Isolated fixture: no core, notes roots, production preferences or credentials.
#import <Cocoa/Cocoa.h>

void *type_updater_create(bool (*prepare)(void *), void *context);
void type_updater_check(void *handle);
void type_updater_set_automatic(void *handle, bool enabled);

@interface SmokeDelegate : NSObject <NSApplicationDelegate>
@property NSWindow *window;
@property NSTextView *text;
@property void *updater;
- (BOOL)save;
@end

static NSString *directory(void) { return @"/private/tmp/type-gpui-updater-smoke-data"; }
static bool prepare(void *context) { return [(__bridge SmokeDelegate *)context save]; }

@implementation SmokeDelegate
- (BOOL)save {
    NSError *error = nil;
    BOOL result = [self.text.string writeToFile:[directory() stringByAppendingPathComponent:@"note.txt"]
                                   atomically:YES encoding:NSUTF8StringEncoding error:&error];
    if (!result) NSLog(@"Fixture save failed: %@", error);
    return result;
}
- (void)check:(id)sender { type_updater_check(self.updater); }
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)app {
    return [self save] ? NSTerminateNow : NSTerminateCancel;
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app { return YES; }
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [NSFileManager.defaultManager createDirectoryAtPath:directory() withIntermediateDirectories:YES
                                            attributes:@{NSFilePosixPermissions: @0700} error:nil];
    NSString *version = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
    NSString *log = [directory() stringByAppendingPathComponent:@"launches.txt"];
    NSString *previous = [NSString stringWithContentsOfFile:log encoding:NSUTF8StringEncoding error:nil] ?: @"";
    [[previous stringByAppendingFormat:@"%@\n", version] writeToFile:log atomically:YES encoding:NSUTF8StringEncoding error:nil];
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 650, 400)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title = [@"Type Updater Smoke — TEST ONLY — " stringByAppendingString:version];
    NSView *content = self.window.contentView;
    NSTextField *label = [NSTextField labelWithString:@"Synthetic text only. Saves under /private/tmp/type-gpui-updater-smoke-data."];
    label.frame = NSMakeRect(20, 355, 610, 25);
    [content addSubview:label];
    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(20, 70, 610, 275)];
    scroll.hasVerticalScroller = YES;
    self.text = [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, 610, 275)];
    self.text.richText = NO;
    self.text.font = [NSFont systemFontOfSize:18];
    self.text.string = [NSString stringWithContentsOfFile:[directory() stringByAppendingPathComponent:@"note.txt"]
                          encoding:NSUTF8StringEncoding error:nil] ?: @"Synthetic note: Привет β 😀\n";
    scroll.documentView = self.text;
    [content addSubview:scroll];
    NSButton *button = [NSButton buttonWithTitle:@"Check for updates" target:self action:@selector(check:)];
    button.frame = NSMakeRect(20, 20, 180, 32);
    [content addSubview:button];
    NSMenu *menu = [NSMenu new];
    NSMenuItem *root = [NSMenuItem new];
    [menu addItem:root];
    root.submenu = [NSMenu new];
    [root.submenu addItemWithTitle:@"Quit Type Updater Smoke" action:@selector(terminate:) keyEquivalent:@"q"];
    NSApp.mainMenu = menu;
    self.updater = type_updater_create(prepare, (__bridge void *)self);
    if (!self.updater) { NSLog(@"Fixture updater failed to start"); [NSApp terminate:nil]; return; }
    type_updater_set_automatic(self.updater, false);
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [self.window makeFirstResponder:self.text];
    [NSApp activateIgnoringOtherApps:YES];
}
@end

int main(void) {
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        SmokeDelegate *delegate = [SmokeDelegate new];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
