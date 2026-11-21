Name:		passphrases
Version:	{{version}}
Release:	1%{?dist}
Summary:	Generate and memorize high-entropy passphrases

Group:		Applications/Productivity
License:	MIT
URL:		https://github.com/StephenGenusa/passphrases
Source0:	%{name}-%{version}.tar.gz
BuildArch:	{{arch}}

# the files are a prebuilt Electron application
AutoReqProv:	no
%global debug_package %{nil}
%global __strip /bin/true

%description
Passphrases is a tool that helps you generate high-entropy passphrases and
memorize them using spaced repetition.


%prep
%setup -q


%build
# empty


%install
rm -rf %{buildroot}
mkdir -p %{buildroot}
cp -a * %{buildroot}


%files
%defattr(-,root,root,-)
/opt/Passphrases
%attr(4755,root,root) /opt/Passphrases/chrome-sandbox
/usr/bin/passphrases
/usr/share/applications/passphrases.desktop
/usr/share/icons/hicolor/64x64/apps/passphrases.png
/usr/share/icons/hicolor/256x256/apps/passphrases.png
/usr/share/icons/hicolor/512x512/apps/passphrases.png


%changelog
* Sat Nov 21 2026 Stephen Genusa <github@genusa.com> 0.2.0
- Moved to Electron; new wordlists

* Sun Mar 15 2015 Micah Lee <micah@micahflee.com> 0.1.0
- First build
