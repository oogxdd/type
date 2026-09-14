import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'capture_page.dart';
import 'gestures.dart';
import 'menu_page.dart';

void main() => runApp(const GestureLabApp());

class GestureLabApp extends StatelessWidget {
  const GestureLabApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Gesture Lab',
      debugShowCheckedModeBanner: false,
      scrollBehavior: const _NoGlowScrollBehavior(),
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0E0E12),
        colorScheme: const ColorScheme.dark(primary: Color(0xFF7AA2F7)),
        dividerColor: const Color(0xFF1E1E26),
      ),
      home: const Shell(),
    );
  }
}

class _NoGlowScrollBehavior extends MaterialScrollBehavior {
  const _NoGlowScrollBehavior();

  @override
  Widget buildOverscrollIndicator(
    BuildContext context,
    Widget child,
    ScrollableDetails details,
  ) => child;
}

/// Menu behind, capture in front. The capture page is *never* unmounted — the
/// menu is revealed by translating the capture page off to the right, so text,
/// caret, scroll offset and keyboard state all survive the trip.
class Shell extends StatefulWidget {
  const Shell({super.key});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> with TickerProviderStateMixin {
  late final AnimationController _menu = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 300),
  )..addStatusListener(_onMenuStatus);

  late final AnimationController _commit = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 380),
  );

  late final Animation<double> _commitCurve = CurvedAnimation(
    parent: _commit,
    curve: Curves.easeOutCubic,
  );

  final List<NoteModel> _notes = <NoteModel>[NoteModel(1)];
  int _index = 0;

  /// The page sliding off the top while a new one rides in from below.
  NoteModel? _outgoing;

  NoteModel get _current => _notes[_index];

  @override
  void dispose() {
    _menu.dispose();
    _commit.dispose();
    for (final NoteModel n in _notes) {
      n.dispose();
    }
    super.dispose();
  }

  // ---------------------------------------------------------------- menu

  void _onMenuStatus(AnimationStatus status) {
    gestureDebug.menu.value = _menu.value;
    if (status == AnimationStatus.dismissed) {
      gestureDebug.phase.value = 'capture';
      // Back on the same note, same scroll offset, caret where you left it.
      _current.focus.requestFocus();
    } else if (status == AnimationStatus.completed) {
      gestureDebug.phase.value = 'menu';
    }
  }

  void _onHStart(DragStartDetails _) {
    _menu.stop();
    gestureDebug.phase.value = 'drag-h';
  }

  void _onHUpdate(DragUpdateDetails d) {
    final double w = MediaQuery.sizeOf(context).width;
    _menu.value = (_menu.value + (d.primaryDelta ?? 0) / w).clamp(0.0, 1.0);
    gestureDebug.menu.value = _menu.value;
    if (_menu.value > 0.012) {
      // Drop the keyboard as soon as the drag is real, not on the first pixel.
      FocusManager.instance.primaryFocus?.unfocus();
    }
  }

  void _onHEnd(DragEndDetails d) {
    final double w = MediaQuery.sizeOf(context).width;
    final double v = d.primaryVelocity ?? 0;
    // A decisive flick beats position; otherwise go wherever you are closest to.
    final bool open = v.abs() > 420 ? v > 0 : _menu.value > 0.4;
    _settleMenu(open, v / w);
  }

  void _onHCancel() => _settleMenu(_menu.value > 0.5, 0);

  void _settleMenu(bool open, double normalizedVelocity) {
    _menu.fling(
      velocity: open
          ? math.max(normalizedVelocity, 1.6)
          : math.min(normalizedVelocity, -1.6),
    );
  }

  void _closeMenu() => _settleMenu(false, 0);

  void _openNote(int i) {
    setState(() => _index = i);
    _closeMenu();
  }

  // ------------------------------------------------------------- new note

  /// Files the current note and rides a blank one in from the bottom.
  void _startNewNote() {
    if (_commit.isAnimating) return;
    setState(() {
      _outgoing = _current;
      _notes.add(NoteModel(_notes.length + 1));
      _index = _notes.length - 1;
    });
    gestureDebug.phase.value = 'filing';
    _commit.forward(from: 0).whenComplete(() {
      if (!mounted) return;
      setState(() => _outgoing = null);
      gestureDebug.phase.value = 'capture';
      gestureDebug.pull.value = 0;
    });
  }

  // ---------------------------------------------------------------- build

  @override
  Widget build(BuildContext context) {
    final Size size = MediaQuery.sizeOf(context);

    // Built once per setState, then handed to the AnimatedBuilders as `child`
    // so a 60/120fps drag never rebuilds a TextField.
    final Widget pages = Stack(
      fit: StackFit.expand,
      children: <Widget>[
        if (_outgoing != null)
          _slide(
            dyFactor: -1,
            height: size.height,
            child: CapturePage(
              key: ValueKey<int>(_outgoing!.index),
              note: _outgoing!,
              live: false,
              onPullCommit: () {},
            ),
          ),
        _slide(
          dyFactor: _outgoing == null ? 0 : 1,
          height: size.height,
          child: CapturePage(
            key: ValueKey<int>(_current.index),
            note: _current,
            live: true,
            onPullCommit: _startNewNote,
          ),
        ),
      ],
    );

    final Widget menu = MenuPage(
      notes: _notes,
      currentIndex: _index,
      onOpenNote: _openNote,
      onClose: _closeMenu,
    );

    return Scaffold(
      // The Stack spans the full screen; each page pads itself above the
      // keyboard so the pull tab can never hide behind it.
      resizeToAvoidBottomInset: false,
      body: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          // Menu, with a little parallax so it reads as "underneath".
          AnimatedBuilder(
            animation: _menu,
            child: menu,
            builder: (BuildContext context, Widget? child) =>
                Transform.translate(
                  offset: Offset(-size.width * 0.28 * (1 - _menu.value), 0),
                  child: child,
                ),
          ),
          AnimatedBuilder(
            animation: _menu,
            builder: (BuildContext context, _) => IgnorePointer(
              child: ColoredBox(
                color: Colors.black.withValues(alpha: 0.55 * (1 - _menu.value)),
              ),
            ),
          ),
          // Capture, pushed right to reveal the menu.
          AnimatedBuilder(
            animation: _menu,
            child: pages,
            builder: (BuildContext context, Widget? child) {
              final double t = _menu.value;
              return Transform.translate(
                offset: Offset(size.width * t, 0),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    boxShadow: t > 0.002
                        ? <BoxShadow>[
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.55),
                              blurRadius: 32,
                            ),
                          ]
                        : const <BoxShadow>[],
                  ),
                  child: Stack(
                    fit: StackFit.expand,
                    children: <Widget>[
                      child!,
                      // While the menu is out, the capture page is a big
                      // "tap to come back" target instead of a text field.
                      if (t > 0.002)
                        GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: _closeMenu,
                        ),
                    ],
                  ),
                ),
              );
            },
          ),
          // The swipe layer sits ON TOP of the pages, not around them.
          //
          // A TextField installs a TapAndHorizontalDragGestureRecognizer for
          // caret dragging, and on Android it is built with
          // eagerVictoryOnDrag: true — it claims the arena the instant it
          // clears the touch slop. As an *ancestor* we were dispatched after
          // it, so on a fast flick (one 30px pointer move clears both
          // thresholds at once) the field won every time and the menu never
          // opened. Flutter also never plumbs gestureSettings into that
          // recognizer, so its slop cannot be tuned from the outside.
          //
          // A Stack hit-tests topmost-first, and HitTestBehavior.translucent
          // adds this layer to the hit path *without* consuming the touch. So
          // this recognizer is dispatched before the field's, taps and
          // scrolls still fall through to the page underneath, and the
          // outcome stops depending on how fast the finger happens to move.
          Positioned.fill(
            child: RawGestureDetector(
              behavior: HitTestBehavior.translucent,
              gestures: <Type, GestureRecognizerFactory>{
                DirectionalHorizontalDragRecognizer:
                    GestureRecognizerFactoryWithHandlers<
                      DirectionalHorizontalDragRecognizer
                    >(
                      () =>
                          DirectionalHorizontalDragRecognizer(debugOwner: this),
                      (DirectionalHorizontalDragRecognizer r) {
                        r
                          ..onStart = _onHStart
                          ..onUpdate = _onHUpdate
                          ..onEnd = _onHEnd
                          ..onCancel = _onHCancel;
                      },
                    ),
              },
            ),
          ),
          const _Hud(),
        ],
      ),
    );
  }

  Widget _slide({
    required double dyFactor,
    required double height,
    required Widget child,
  }) {
    if (dyFactor == 0) return child;
    return AnimatedBuilder(
      animation: _commitCurve,
      child: child,
      builder: (BuildContext context, Widget? c) => Transform.translate(
        offset: Offset(
          0,
          dyFactor < 0
              ? -height * _commitCurve.value
              : height * (1 - _commitCurve.value),
        ),
        child: c,
      ),
    );
  }
}

/// Live gesture readout. The point of the whole app is feeling the numbers.
class _Hud extends StatelessWidget {
  const _Hud();

  @override
  Widget build(BuildContext context) {
    return Positioned(
      top: MediaQuery.paddingOf(context).top + 8,
      right: 10,
      child: ValueListenableBuilder<bool>(
        valueListenable: gestureDebug.visible,
        builder: (BuildContext context, bool on, _) {
          if (!on) return const SizedBox.shrink();
          return GestureDetector(
            onTap: () => gestureDebug.visible.value = false,
            child: AnimatedBuilder(
              animation: Listenable.merge(<Listenable>[
                gestureDebug.axis,
                gestureDebug.menu,
                gestureDebug.pull,
                gestureDebug.armed,
                gestureDebug.phase,
              ]),
              builder: (BuildContext context, _) {
                final bool armed = gestureDebug.armed.value;
                return Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.62),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: armed
                          ? const Color(0xFF7AA2F7)
                          : Colors.white.withValues(alpha: 0.12),
                    ),
                  ),
                  child: DefaultTextStyle(
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 10,
                      height: 1.5,
                      color: Colors.white.withValues(alpha: 0.72),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(gestureDebug.phase.value),
                        Text('d ${gestureDebug.axis.value}'),
                        Text(
                          'menu ${gestureDebug.menu.value.toStringAsFixed(2)}',
                        ),
                        Text(
                          'pull ${gestureDebug.pull.value.toStringAsFixed(0)}'
                          '/${kPullThreshold.toStringAsFixed(0)}'
                          '${armed ? ' ●' : ''}',
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 10,
                            height: 1.5,
                            color: armed
                                ? const Color(0xFF7AA2F7)
                                : Colors.white.withValues(alpha: 0.72),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
