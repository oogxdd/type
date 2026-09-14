import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'gestures.dart';

/// How far past the end of the note you must drag before a release files it.
const double kPullThreshold = 80.0;

/// Height of the little tab that gets pulled out of the bottom edge.
const double kTabHeight = 44.0;

/// A note lives in the shell, not in the page, so its text and caret survive
/// the page being scrolled off the top or revisited from the menu.
class NoteModel {
  NoteModel(this.index)
    : text = TextEditingController(),
      focus = FocusNode(debugLabel: 'note-$index');

  final int index;
  final TextEditingController text;
  final FocusNode focus;

  String get title {
    final String first = text.text.trim().split('\n').first.trim();
    return first.isEmpty ? 'Empty note' : first;
  }

  bool get isEmpty => text.text.trim().isEmpty;

  void dispose() {
    text.dispose();
    focus.dispose();
  }
}

/// The capture screen: one full-bleed text field you can type into immediately,
/// plus the inverted pull-to-refresh that files it and hands you a blank page.
///
/// The pull rides on the scroll view's own overscroll rather than a competing
/// drag recognizer. That is the whole trick: you have to reach the end of the
/// note before there *is* any overscroll, so "scroll to the bottom, then keep
/// pulling" falls out of the physics instead of having to be arbitrated.
class CapturePage extends StatefulWidget {
  const CapturePage({
    super.key,
    required this.note,
    required this.live,
    required this.onPullCommit,
  });

  final NoteModel note;

  /// False for the page that is currently sliding off the top.
  final bool live;

  final VoidCallback onPullCommit;

  @override
  State<CapturePage> createState() => _CapturePageState();
}

class _CapturePageState extends State<CapturePage> {
  final ScrollController _scroll = ScrollController();
  final ValueNotifier<double> _pull = ValueNotifier<double>(0);
  bool _armed = false;

  @override
  void dispose() {
    _scroll.dispose();
    _pull.dispose();
    super.dispose();
  }

  bool _onScroll(ScrollNotification n) {
    // depth > 0 would be the text field's own (disabled) scrollable.
    if (n.depth != 0 || n.metrics.axis != Axis.vertical) return false;
    final double over = n.metrics.pixels - n.metrics.maxScrollExtent;
    _pull.value = over > 0 ? over : 0;
    if (widget.live) gestureDebug.pull.value = _pull.value;

    final bool armed = widget.live && _pull.value >= kPullThreshold;
    if (armed != _armed) {
      _armed = armed;
      if (widget.live) {
        gestureDebug.armed.value = armed;
        HapticFeedback.selectionClick();
      }
    }
    return false;
  }

  /// The decision point is finger-up, not the end of the bounce-back, so this
  /// hangs off a raw [Listener] instead of a ScrollEndNotification.
  void _onRelease(PointerEvent _) {
    if (!widget.live || !_armed) return;
    _armed = false;
    gestureDebug.armed.value = false;
    HapticFeedback.mediumImpact();
    widget.onPullCommit();
  }

  @override
  Widget build(BuildContext context) {
    final MediaQueryData media = MediaQuery.of(context);
    final ThemeData theme = Theme.of(context);

    return IgnorePointer(
      ignoring: !widget.live,
      child: Container(
        color: theme.scaffoldBackgroundColor,
        child: Padding(
          // Sit above the keyboard so the pull tab is never behind it.
          padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
          child: Stack(
            children: <Widget>[
              Positioned.fill(child: _buildEditor(context, media)),
              if (widget.live) _buildTab(theme),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildEditor(BuildContext context, MediaQueryData media) {
    return Listener(
      onPointerUp: _onRelease,
      onPointerCancel: _onRelease,
      child: NotificationListener<ScrollNotification>(
        onNotification: _onScroll,
        child: GestureDetector(
          behavior: HitTestBehavior.translucent,
          onTap: () => widget.note.focus.requestFocus(),
          child: LayoutBuilder(
            builder: (BuildContext ctx, BoxConstraints c) {
              return SingleChildScrollView(
                controller: _scroll,
                // Bouncing on every platform: the rubber-band resistance *is*
                // the pull gesture's feel, and Android's clamping physics has
                // no overscroll to read.
                physics: const AlwaysScrollableScrollPhysics(
                  parent: BouncingScrollPhysics(),
                ),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: c.maxHeight),
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(
                      22,
                      media.padding.top + 16,
                      22,
                      kTabHeight + 28,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'note ${widget.note.index}',
                          style: TextStyle(
                            fontSize: 11,
                            letterSpacing: 1.4,
                            fontWeight: FontWeight.w600,
                            color: Colors.white.withValues(alpha: 0.26),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: widget.note.text,
                          focusNode: widget.note.focus,
                          autofocus: widget.live,
                          maxLines: null,
                          // Let the outer scroll view own every vertical drag.
                          scrollPhysics: const NeverScrollableScrollPhysics(),
                          keyboardAppearance: Brightness.dark,
                          cursorColor: const Color(0xFF7AA2F7),
                          style: const TextStyle(
                            fontSize: 19,
                            height: 1.5,
                            color: Color(0xFFE8E8EC),
                          ),
                          decoration: InputDecoration.collapsed(
                            hintText: 'Start typing…',
                            hintStyle: TextStyle(
                              color: Colors.white.withValues(alpha: 0.22),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildTab(ThemeData theme) {
    return ValueListenableBuilder<double>(
      valueListenable: _pull,
      builder: (BuildContext context, double pull, _) {
        // Clamped so a hard fling does not throw the tab into orbit.
        final double reveal = math.min(pull, kTabHeight + 96);
        if (reveal <= 0.5) return const SizedBox.shrink();
        final double progress = (pull / kPullThreshold).clamp(0.0, 1.0);
        final bool armed = progress >= 1.0;
        final double stem = math.max(0.0, reveal - kTabHeight);
        final Color accent = armed
            ? const Color(0xFF7AA2F7)
            : const Color(0xFF2A2A32);

        return Positioned(
          left: 0,
          right: 0,
          bottom: reveal - kTabHeight,
          child: Opacity(
            opacity: (reveal / (kTabHeight * 0.5)).clamp(0.0, 1.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Container(
                  height: kTabHeight,
                  padding: const EdgeInsets.symmetric(horizontal: 18),
                  margin: const EdgeInsets.symmetric(horizontal: 60),
                  decoration: BoxDecoration(
                    color: accent,
                    borderRadius: BorderRadius.circular(kTabHeight / 2),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      Transform.rotate(
                        angle: progress * math.pi,
                        child: Icon(
                          Icons.arrow_upward_rounded,
                          size: 16,
                          color: armed ? Colors.black : Colors.white70,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        armed ? 'Release for new note' : 'Keep pulling',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: armed ? Colors.black : Colors.white70,
                        ),
                      ),
                    ],
                  ),
                ),
                // The "string" the tab is being pulled out on.
                Container(width: 2, height: stem, color: accent),
              ],
            ),
          ),
        );
      },
    );
  }
}
