import 'package:flutter/material.dart';

import 'capture_page.dart';
import 'gestures.dart';

/// The screen that lives *behind* the capture page. It is always mounted; the
/// capture page just slides off it to the right.
class MenuPage extends StatelessWidget {
  const MenuPage({
    super.key,
    required this.notes,
    required this.currentIndex,
    required this.onOpenNote,
    required this.onClose,
  });

  final List<NoteModel> notes;
  final int currentIndex;
  final ValueChanged<int> onOpenNote;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF07070A),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 18, 16, 6),
              child: Row(
                children: <Widget>[
                  const Expanded(
                    child: Text(
                      'Notes',
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFFE8E8EC),
                      ),
                    ),
                  ),
                  ValueListenableBuilder<bool>(
                    valueListenable: gestureDebug.visible,
                    builder: (BuildContext context, bool on, _) {
                      return TextButton(
                        onPressed: () => gestureDebug.visible.value = !on,
                        child: Text(
                          on ? 'hide hud' : 'show hud',
                          style: const TextStyle(fontSize: 12),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
              child: Text(
                'swipe left anywhere to go back — the capture page is never unmounted',
                style: TextStyle(
                  fontSize: 12,
                  height: 1.4,
                  color: Colors.white.withValues(alpha: 0.34),
                ),
              ),
            ),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.only(bottom: 32),
                itemCount: notes.length,
                itemBuilder: (BuildContext context, int i) {
                  final NoteModel note = notes[i];
                  final bool active = i == currentIndex;
                  return ListTile(
                    dense: true,
                    onTap: () => onOpenNote(i),
                    leading: Text(
                      '${note.index}',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: Colors.white.withValues(alpha: 0.3),
                      ),
                    ),
                    title: Text(
                      note.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                        color: note.isEmpty
                            ? Colors.white.withValues(alpha: 0.3)
                            : const Color(0xFFE8E8EC),
                      ),
                    ),
                    trailing: active
                        ? const Icon(
                            Icons.circle,
                            size: 8,
                            color: Color(0xFF7AA2F7),
                          )
                        : null,
                  );
                },
              ),
            ),
            const Divider(height: 1),
            ListTile(
              dense: true,
              onTap: onClose,
              leading: const Icon(Icons.arrow_back_rounded, size: 18),
              title: const Text(
                'Back to capture',
                style: TextStyle(fontSize: 14),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
